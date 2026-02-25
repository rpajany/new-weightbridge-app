// services/serialService.js
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

class SerialService {
  constructor() {
    this.port             = null;
    this.parser           = null;
    this.currentWeight    = 0;
    this.isConnected      = false;
    this.isSimulation     = false;
    this.portPath         = null;
    this.baudRate         = 9600;
    this.wsClients        = new Set();
    this.weightBuffer     = [];
    this.stableWeight     = 0;
    this.simInterval      = null;
    this.reconnectTimer   = null;
    this.reconnectActive  = false;
  }

  // ── Called once from server.js on startup
  initialize(portPath, baudRate = 9600) {
    this.portPath = portPath;
    this.baudRate = parseInt(baudRate);
    this._tryConnect();
  }

  // ── Called from settings route when user changes port/baud
  reconnect(portPath, baudRate = 9600) {
    console.log(`🔄 Serial reconnect requested: ${portPath} @ ${baudRate}`);
    this.portPath = portPath;
    this.baudRate = parseInt(baudRate);

    if (this.port && this.port.isOpen) {
      try { this.port.close(); } catch (e) {}
    }
    this.port   = null;
    this.parser = null;

    this._stopSimulation();
    this._stopReconnectLoop();
    this._tryConnect();
  }

  // ── Single connection attempt
  _tryConnect() {
    if (this.reconnectActive) return;
    this.reconnectActive = true;

    try {
      const sp     = new SerialPort({ path: this.portPath, baudRate: this.baudRate, autoOpen: false });
      const parser = sp.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      sp.open((err) => {
        this.reconnectActive = false;

        if (err) {
          console.warn(`⚠️  Serial ${this.portPath}: ${err.message}`);
          this.isConnected  = false;
          this.isSimulation = true;
          this._startSimulationIfNeeded();
          this._startReconnectLoop();
          return;
        }

        // ✅ Successfully opened
        console.log(`✅ Serial port ${this.portPath} opened at ${this.baudRate} baud`);
        this.port         = sp;
        this.parser       = parser;
        this.isConnected  = true;
        this.isSimulation = false;

        this._stopSimulation();
        this._stopReconnectLoop();
        this.broadcastStatus();

        parser.on('data', (data) => this.parseWeight(data));

        sp.on('error', (err) => {
          console.error('Serial runtime error:', err.message);
          this._onPortLost();
        });

        sp.on('close', () => {
          console.warn('Serial port closed unexpectedly — will retry in 5 s');
          this._onPortLost();
        });
      });

    } catch (err) {
      this.reconnectActive = false;
      console.error('Serial init exception:', err.message);
      this.isConnected  = false;
      this.isSimulation = true;
      this._startSimulationIfNeeded();
      this._startReconnectLoop();
    }
  }

  _onPortLost() {
    this.isConnected  = false;
    this.isSimulation = true;
    this.port   = null;
    this.parser = null;
    this.broadcastStatus();
    this._startSimulationIfNeeded();
    this._startReconnectLoop();
  }

  // ── Retry loop: poll every 5 seconds
  _startReconnectLoop() {
    if (this.reconnectTimer) return;
    console.log('🔁 Serial reconnect loop started (every 5 s)');
    this.reconnectTimer = setInterval(async () => {
      if (this.isConnected) { this._stopReconnectLoop(); return; }
      const available = await this._isPortAvailable(this.portPath);
      if (available) {
        console.log(`🔌 Port ${this.portPath} detected — reconnecting...`);
        this._tryConnect();
      }
    }, 5000);
  }

  _stopReconnectLoop() {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async _isPortAvailable(portPath) {
    try {
      const ports = await SerialPort.list();
      return ports.some(p =>
        p.path === portPath ||
        p.path.toLowerCase() === portPath.toLowerCase()
      );
    } catch (e) { return false; }
  }

  // ── Simulation — only while real port is unavailable
  _startSimulationIfNeeded() {
    if (this.simInterval) return;
    console.log('⚠️  SIMULATION mode active');
    let base = 39170;
    this.simInterval = setInterval(() => {
      if (this.isConnected) { this._stopSimulation(); return; }
      const noise = Math.floor(Math.random() * 20 - 10);
      base = Math.max(0, base + noise);
      this.updateWeight(base);
    }, 1000);
  }

  _stopSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
      console.log('✅ Simulation stopped — real serial active');
    }
  }

  // ── Weight parsing
  parseWeight(data) {
    const cleaned = data.toString().trim();
    const match   = cleaned.match(/[\+\-]?(\d+\.?\d*)/);
    if (match) {
      const w = parseFloat(match[1]);
      if (w >= 0 && w < 200000) this.updateWeight(w);
    }
  }

  updateWeight(weight) {
    this.currentWeight = weight;
    this.weightBuffer.push(weight);
    if (this.weightBuffer.length > 5) this.weightBuffer.shift();

    const avg      = this.weightBuffer.reduce((a, b) => a + b, 0) / this.weightBuffer.length;
    const isStable = this.weightBuffer.every(w => Math.abs(w - avg) < 5);
    if (isStable && this.weightBuffer.length === 5) this.stableWeight = Math.round(avg);

    this.broadcastWeight({
      weight:       this.currentWeight,
      stable:       isStable,
      stableWeight: this.stableWeight,
      simulation:   this.isSimulation,
      timestamp:    new Date().toISOString()
    });
  }

  // ── WebSocket
  addWSClient(ws) {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
    ws.send(JSON.stringify({
      type: 'weight', weight: this.currentWeight, stable: false,
      stableWeight: this.stableWeight, simulation: this.isSimulation,
      timestamp: new Date().toISOString()
    }));
  }

  broadcastWeight(data) {
    const msg = JSON.stringify({ type: 'weight', ...data });
    this.wsClients.forEach(c => { if (c.readyState === 1) c.send(msg); });
  }

  broadcastStatus() {
    const msg = JSON.stringify({ type: 'status', connected: this.isConnected, simulation: this.isSimulation });
    this.wsClients.forEach(c => { if (c.readyState === 1) c.send(msg); });
  }

  getCurrentWeight() {
    return { weight: this.currentWeight, stableWeight: this.stableWeight, simulation: this.isSimulation, timestamp: new Date().toISOString() };
  }

  static async listPorts() {
    try { return await SerialPort.list(); } catch (e) { return []; }
  }
}

module.exports = new SerialService();
