// routes/bills.js
const express = require('express');
const router = express.Router();
const WeighBill = require('../models/WeighBill');
const serialService = require('../services/serialService');
const cameraService = require('../services/cameraService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer for camera image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/snapshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `upload_${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// GET all bills with pagination
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, date } = req.query;
    const query = {};
    
    if (search) {
      query.$or = [
        { vehicleNo: new RegExp(search, 'i') },
        { customer: new RegExp(search, 'i') },
        { material: new RegExp(search, 'i') }
      ];
    }
    
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      query.dateTime = { $gte: start, $lt: end };
    }

    const bills = await WeighBill.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await WeighBill.countDocuments(query);
    
    res.json({ bills, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single bill
router.get('/:id', async (req, res) => {
  try {
    const bill = await WeighBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    res.json(bill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create new bill
router.post('/', async (req, res) => {
  try {
    const { vehicleNo, material, customer, charges } = req.body;
    
    const bill = new WeighBill({
      vehicleNo: vehicleNo?.toUpperCase(),
      material,
      customer,
      charges: parseFloat(charges) || 0,
      status: 'pending'
    });
    
    await bill.save();
    res.status(201).json(bill);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH capture gross weight
router.patch('/:id/gross-weight', async (req, res) => {
  try {
    const bill = await WeighBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    // Weight: prefer body value, then serial stable, then serial current
    const weightData = serialService.getCurrentWeight();
    const weight = req.body.weight
      || (weightData.stableWeight > 0 ? weightData.stableWeight : null)
      || weightData.weight
      || 0;

    if (!weight || parseFloat(weight) <= 0) {
      return res.status(400).json({ error: 'No valid weight reading. Use manual override.' });
    }

    bill.grossWeight = { value: parseFloat(weight), timestamp: new Date() };
    bill.status = 'gross_weighed';

    // Capture camera snapshots — don't block save if cameras fail
    try {
      const snapshots = await cameraService.captureBoth();
      if (snapshots.camera1) bill.camera1Image = snapshots.camera1.base64;
      if (snapshots.camera2) bill.camera2Image = snapshots.camera2.base64;
    } catch (camErr) {
      console.warn('Camera capture failed (non-fatal):', camErr.message);
    }

    // Preserve any images already manually uploaded via frontend
    if (req.body.camera1Image && !bill.camera1Image) bill.camera1Image = req.body.camera1Image;
    if (req.body.camera2Image && !bill.camera2Image) bill.camera2Image = req.body.camera2Image;

    await bill.save();
    res.json(bill);
  } catch (err) {
    console.error('gross-weight error:', err);
    res.status(400).json({ error: err.message });
  }
});

// PATCH capture tare weight — calculates net weight
router.patch('/:id/tare-weight', async (req, res) => {
  try {
    const bill = await WeighBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    if (!bill.grossWeight || !bill.grossWeight.value) {
      return res.status(400).json({ error: 'Gross weight must be captured first' });
    }

    const weightData = serialService.getCurrentWeight();
    const weight = req.body.weight
      || (weightData.stableWeight > 0 ? weightData.stableWeight : null)
      || weightData.weight
      || 0;

    if (!weight || parseFloat(weight) <= 0) {
      return res.status(400).json({ error: 'No valid weight reading. Use manual override.' });
    }

    const grossVal = parseFloat(bill.grossWeight.value);
    const tareVal  = parseFloat(weight);

    bill.tareWeight  = { value: tareVal, timestamp: new Date() };
    bill.netWeight   = grossVal - tareVal;   // ← explicit calculation, no hook dependency
    bill.status      = 'completed';

    console.log(`Bill #${bill.billNo} — Gross: ${grossVal}, Tare: ${tareVal}, Net: ${bill.netWeight}`);

    // Capture tare-time camera snapshots (non-blocking)
    try {
      const snapshots = await cameraService.captureBoth();
      if (snapshots.camera1 && !bill.camera1Image) bill.camera1Image = snapshots.camera1.base64;
      if (snapshots.camera2 && !bill.camera2Image) bill.camera2Image = snapshots.camera2.base64;
    } catch (camErr) {
      console.warn('Camera capture failed (non-fatal):', camErr.message);
    }

    await bill.save();
    res.json(bill);
  } catch (err) {
    console.error('tare-weight error:', err);
    res.status(400).json({ error: err.message });
  }
});

// PATCH update bill details — uses findById+save so hooks fire correctly
router.patch('/:id', async (req, res) => {
  try {
    const bill = await WeighBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    // Apply allowed field updates
    const allowed = ['vehicleNo','material','customer','charges','status',
                     'camera1Image','camera2Image','printedAt',
                     'grossWeight','tareWeight','netWeight'];
    allowed.forEach(key => {
      if (req.body[key] !== undefined) bill[key] = req.body[key];
    });

    // Recalculate net weight if both values are present
    const gross = bill.grossWeight && bill.grossWeight.value;
    const tare  = bill.tareWeight  && bill.tareWeight.value;
    if (gross != null && tare != null) {
      bill.netWeight = parseFloat(gross) - parseFloat(tare);
    }

    await bill.save();
    res.json(bill);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE bill
router.delete('/:id', async (req, res) => {
  try {
    await WeighBill.findByIdAndDelete(req.params.id);
    res.json({ message: 'Bill deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST upload camera images manually
router.post('/:id/images', upload.fields([
  { name: 'camera1', maxCount: 1 },
  { name: 'camera2', maxCount: 1 }
]), async (req, res) => {
  try {
    const bill = await WeighBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    if (req.files?.camera1) {
      const file = req.files.camera1[0];
      const data = fs.readFileSync(file.path);
      bill.camera1Image = `data:image/jpeg;base64,${data.toString('base64')}`;
    }
    if (req.files?.camera2) {
      const file = req.files.camera2[0];
      const data = fs.readFileSync(file.path);
      bill.camera2Image = `data:image/jpeg;base64,${data.toString('base64')}`;
    }

    await bill.save();
    res.json(bill);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET current weight from serial
router.get('/serial/weight', (req, res) => {
  res.json(serialService.getCurrentWeight());
});

// GET available serial ports
router.get('/serial/ports', async (req, res) => {
  const ports = await require('../services/serialService').constructor?.listPorts?.() || [];
  res.json(ports);
});

// GET dashboard stats
router.get('/stats/dashboard', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [totalBills, todayBills, completedToday, totalWeight] = await Promise.all([
      WeighBill.countDocuments(),
      WeighBill.countDocuments({ createdAt: { $gte: today } }),
      WeighBill.countDocuments({ status: 'completed', createdAt: { $gte: today } }),
      WeighBill.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$netWeight' } } }
      ])
    ]);

    res.json({
      totalBills,
      todayBills,
      completedToday,
      totalWeightToday: totalWeight[0]?.total || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
