// models/WeighBill.js
const mongoose = require('mongoose');

// Atomic counter for bill numbers
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', CounterSchema);

const WeighBillSchema = new mongoose.Schema({
  billNo:    { type: Number, unique: true },
  dateTime:  { type: Date, default: Date.now },
  vehicleNo: { type: String, required: true, uppercase: true, trim: true },
  material:  { type: String, required: true, trim: true },
  customer:  { type: String, required: true, trim: true },
  charges:   { type: Number, default: 0 },
  grossWeight: {
    value:     { type: Number, default: null },
    timestamp: { type: Date }
  },
  tareWeight: {
    value:     { type: Number, default: null },
    timestamp: { type: Date }
  },
  netWeight:    { type: Number, default: null },
  camera1Image: { type: String, default: null },
  camera2Image: { type: String, default: null },
  printedAt:    { type: Date },
  status: {
    type: String,
    enum: ['pending', 'gross_weighed', 'completed'],
    default: 'pending'
  }
}, { timestamps: true });

// ── Assign billNo before validation (atomic, race-condition safe)
WeighBillSchema.pre('validate', async function (next) {
  if (this.isNew && !this.billNo) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        'billNo',
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      this.billNo = counter.seq;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// ── Calculate net weight on every save
WeighBillSchema.pre('save', function (next) {
  const gross = this.grossWeight && this.grossWeight.value;
  const tare  = this.tareWeight  && this.tareWeight.value;
  if (gross != null && tare != null && !isNaN(gross) && !isNaN(tare)) {
    this.netWeight = parseFloat(gross) - parseFloat(tare);
  }
  next();
});

// ── Static helper used by routes that need net weight after findByIdAndUpdate
WeighBillSchema.statics.recalcNetWeight = async function (id) {
  const doc = await this.findById(id);
  if (!doc) return null;
  const gross = doc.grossWeight && doc.grossWeight.value;
  const tare  = doc.tareWeight  && doc.tareWeight.value;
  if (gross != null && tare != null) {
    doc.netWeight = parseFloat(gross) - parseFloat(tare);
    await doc.save();
  }
  return doc;
};

module.exports = mongoose.model('WeighBill', WeighBillSchema);

