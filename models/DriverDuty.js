import mongoose from 'mongoose';

const DriverDutySchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, index: true },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date }, // null while on duty
    source: { type: String, default: 'driverApp' },
    note: { type: String },
  },
  { timestamps: true }
);

DriverDutySchema.index({ driverId: 1, startAt: -1 });

const DriverDutyModel = mongoose.model('DriverDuty', DriverDutySchema);
export default DriverDutyModel;
