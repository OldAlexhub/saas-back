import mongoose from 'mongoose';

const DriverHOSSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true },
    // date in YYYY-MM-DD (UTC) to make daily aggregation simple
    date: { type: String, required: true },
    // minutes reported for this entry (append-only)
    minutes: { type: Number, required: true },
  },
  { timestamps: true }
);

const DriverHOSModel = mongoose.model('DriverHOS', DriverHOSSchema);
export default DriverHOSModel;
// Explicit indexes
DriverHOSSchema.index({ driverId: 1, date: 1 });
