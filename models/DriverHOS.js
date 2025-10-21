import mongoose from 'mongoose';

const DriverHOSSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, index: true },
    // date in YYYY-MM-DD (UTC) to make daily aggregation simple
    date: { type: String, required: true, index: true },
    // minutes reported for this entry (append-only)
    minutes: { type: Number, required: true },
  },
  { timestamps: true }
);

const DriverHOSModel = mongoose.model('DriverHOS', DriverHOSSchema);
export default DriverHOSModel;
