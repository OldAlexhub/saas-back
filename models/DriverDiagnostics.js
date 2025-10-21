import mongoose from 'mongoose';

const DriverDiagnosticsSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, index: true },
    payload: { type: Object, required: true },
  },
  { timestamps: true }
);

const DriverDiagnosticsModel = mongoose.model('DriverDiagnostics', DriverDiagnosticsSchema);
export default DriverDiagnosticsModel;
