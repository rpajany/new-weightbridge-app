// routes/settings.js — Read/Write .env and hot-reload services
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

const ENV_PATH = path.join(__dirname, '../.env');

function parseEnv(text) {
  const result = {};
  text.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  });
  return result;
}

function writeEnv(updates) {
  let text = '';
  try { text = fs.readFileSync(ENV_PATH, 'utf8'); } catch (e) { text = ''; }
  const lines  = text.split('\n');
  const used   = new Set();
  const updated = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return line;
    const key = trimmed.slice(0, idx).trim();
    if (updates[key] !== undefined) { used.add(key); return `${key}=${updates[key]}`; }
    return line;
  });
  Object.entries(updates).forEach(([k, v]) => { if (!used.has(k)) updated.push(`${k}=${v}`); });
  fs.writeFileSync(ENV_PATH, updated.join('\n'), 'utf8');
}

// GET /api/settings — return current env values (masks passwords)
router.get('/', (req, res) => {
  try {
    const text   = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    const parsed = parseEnv(text);
    if (parsed.CAMERA1_PASS) parsed.CAMERA1_PASS = '***';
    if (parsed.CAMERA2_PASS) parsed.CAMERA2_PASS = '***';
    res.json({ ok: true, settings: parsed });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/settings/serial — save + hot-reload serial port immediately
router.post('/serial', (req, res) => {
  try {
    const { port, baud } = req.body;
    if (!port) return res.status(400).json({ ok: false, error: 'port is required' });
    writeEnv({ SERIAL_PORT: port, BAUD_RATE: baud || '9600' });
    process.env.SERIAL_PORT = port;
    process.env.BAUD_RATE   = baud || '9600';
    // Hot-reload serial port — no server restart needed
    const serial = require('../services/serialService');
    serial.initialize(port, parseInt(baud) || 9600);
    res.json({ ok: true, message: `Connecting to ${port} @ ${baud} baud...` });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/settings/cameras
router.post('/cameras', (req, res) => {
  try {
    const { cam1, cam2, cam1User, cam1Pass, cam2User, cam2Pass } = req.body;
    const updates = {};
    if (cam1     !== undefined) updates.CAMERA1_SNAPSHOT = cam1;
    if (cam2     !== undefined) updates.CAMERA2_SNAPSHOT = cam2;
    if (cam1User !== undefined) updates.CAMERA1_USER     = cam1User;
    if (cam1Pass && cam1Pass !== '***') updates.CAMERA1_PASS = cam1Pass;
    if (cam2User !== undefined) updates.CAMERA2_USER     = cam2User;
    if (cam2Pass && cam2Pass !== '***') updates.CAMERA2_PASS = cam2Pass;
    writeEnv(updates);
    Object.entries(updates).forEach(([k, v]) => { process.env[k] = v; });
    res.json({ ok: true, message: 'Camera settings saved and active.' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/settings/company
router.post('/company', (req, res) => {
  try {
    const { name, addr1, addr2, phone, logo } = req.body;
    const updates = {};
    if (name  !== undefined) updates.COMPANY_NAME  = name;
    if (addr1 !== undefined) updates.COMPANY_ADDR1 = addr1;
    if (addr2 !== undefined) updates.COMPANY_ADDR2 = addr2;
    if (phone !== undefined) updates.COMPANY_PHONE = phone;
    if (logo  !== undefined) updates.COMPANY_LOGO  = logo;
    writeEnv(updates);
    Object.entries(updates).forEach(([k, v]) => { process.env[k] = v; });
    res.json({ ok: true, message: 'Company settings saved.' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/settings/mongo
router.post('/mongo', (req, res) => {
  try {
    const { uri } = req.body;
    if (!uri) return res.status(400).json({ ok: false, error: 'uri is required' });
    writeEnv({ MONGODB_URI: uri });
    process.env.MONGODB_URI = uri;
    res.json({ ok: true, message: 'MongoDB URI saved. Restart server to reconnect database.' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
