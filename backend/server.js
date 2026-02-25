// server.js - Weigh Bridge Management System
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const serialService  = require('./services/serialService');
const billsRouter    = require('./routes/bills');
const printerRouter  = require('./routes/printer');
const masterRouter   = require('./routes/master');
const settingsRouter = require('./routes/settings');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/snapshots', express.static(path.join(__dirname, 'public/snapshots')));
app.use(express.static(path.join(__dirname, '../frontend/public')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/weighbridge';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected:', MONGODB_URI))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// WebSocket for live weight streaming
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  serialService.addWSClient(ws);
  
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      // Handle commands from frontend
      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch (e) {}
  });
});

// Initialize serial port
const SERIAL_PORT = process.env.SERIAL_PORT || '/dev/ttyUSB0';
const BAUD_RATE = process.env.BAUD_RATE || 9600;
serialService.initialize(SERIAL_PORT, BAUD_RATE);

// API Routes
app.use('/api/bills',    billsRouter);
app.use('/api/printer',  printerRouter);
app.use('/api/master',   masterRouter);
app.use('/api/settings', settingsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    serialPort: serialService.isConnected,
    uptime: process.uptime()
  });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Weigh Bridge Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready`);
});
