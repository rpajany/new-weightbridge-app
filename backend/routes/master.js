// routes/master.js — Materials & Vehicles master data
const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');

// ── MATERIAL MODEL ─────────────────────────────────────────────────────────
const MaterialSchema = new mongoose.Schema({
  name:      { type: String, required: true, unique: true, uppercase: true, trim: true },
  unit:      { type: String, default: 'Kg', trim: true },
  active:    { type: Boolean, default: true }
}, { timestamps: true });
const Material = mongoose.model('Material', MaterialSchema);

// ── VEHICLE MODEL ──────────────────────────────────────────────────────────
const VehicleSchema = new mongoose.Schema({
  vehicleNo:     { type: String, required: true, unique: true, uppercase: true, trim: true },
  driverName:    { type: String, trim: true, default: '' },
  contactNumber: { type: String, trim: true, default: '' },
  vehicleType:   { type: String, trim: true, default: '' },
  ownerName:     { type: String, trim: true, default: '' },
  active:        { type: Boolean, default: true }
}, { timestamps: true });
const Vehicle = mongoose.model('Vehicle', VehicleSchema);

// ═══════════════════════════════════════════════════════════════════════════
// MATERIALS
// ═══════════════════════════════════════════════════════════════════════════

// GET all active materials
router.get('/materials', async (req, res) => {
  try {
    const { all } = req.query;
    const filter = all === 'true' ? {} : { active: true };
    const materials = await Material.find(filter).sort({ name: 1 });
    res.json(materials);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST add material
router.post('/materials', async (req, res) => {
  try {
    const { name, unit } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Material name is required' });
    const mat = new Material({ name: name.trim().toUpperCase(), unit: unit || 'Kg' });
    await mat.save();
    res.status(201).json(mat);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Material already exists' });
    res.status(400).json({ error: err.message });
  }
});

// PUT update material
router.put('/materials/:id', async (req, res) => {
  try {
    const mat = await Material.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!mat) return res.status(404).json({ error: 'Material not found' });
    res.json(mat);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE material (soft delete)
router.delete('/materials/:id', async (req, res) => {
  try {
    await Material.findByIdAndUpdate(req.params.id, { active: false });
    res.json({ message: 'Material deactivated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// VEHICLES
// ═══════════════════════════════════════════════════════════════════════════

// GET all active vehicles
router.get('/vehicles', async (req, res) => {
  try {
    const { all, search } = req.query;
    const filter = all === 'true' ? {} : { active: true };
    if (search) filter.vehicleNo = new RegExp(search, 'i');
    const vehicles = await Vehicle.find(filter).sort({ vehicleNo: 1 });
    res.json(vehicles);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single vehicle by vehicleNo (for autocomplete fill)
router.get('/vehicles/lookup/:vehicleNo', async (req, res) => {
  try {
    const v = await Vehicle.findOne({
      vehicleNo: req.params.vehicleNo.toUpperCase(),
      active: true
    });
    if (!v) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(v);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST add vehicle
router.post('/vehicles', async (req, res) => {
  try {
    const { vehicleNo, driverName, contactNumber, vehicleType, ownerName } = req.body;
    if (!vehicleNo || !vehicleNo.trim()) return res.status(400).json({ error: 'Vehicle No is required' });
    const vehicle = new Vehicle({
      vehicleNo:     vehicleNo.trim().toUpperCase(),
      driverName:    driverName    || '',
      contactNumber: contactNumber || '',
      vehicleType:   vehicleType   || '',
      ownerName:     ownerName     || ''
    });
    await vehicle.save();
    res.status(201).json(vehicle);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Vehicle already exists' });
    res.status(400).json({ error: err.message });
  }
});

// PUT update vehicle
router.put('/vehicles/:id', async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE vehicle (soft delete)
router.delete('/vehicles/:id', async (req, res) => {
  try {
    await Vehicle.findByIdAndUpdate(req.params.id, { active: false });
    res.json({ message: 'Vehicle deactivated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
