import mongoose from "mongoose";

const DriverTripEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, trim: true },
    driverId: { type: String, required: true, trim: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "bookings", required: true },
    tripSessionId: { type: String, trim: true },
    type: { type: String, required: true, trim: true },
    sequence: { type: Number },
    capturedAt: { type: Date, required: true, default: Date.now },
    receivedAt: { type: Date, required: true, default: Date.now },
    payload: { type: mongoose.Schema.Types.Mixed },
    device: { type: mongoose.Schema.Types.Mixed },
    source: { type: String, default: "driverApp" },
  },
  { timestamps: true },
);

DriverTripEventSchema.index({ driverId: 1, eventId: 1 }, { unique: true });
DriverTripEventSchema.index({ bookingId: 1, capturedAt: 1 });
DriverTripEventSchema.index({ tripSessionId: 1, sequence: 1 });
DriverTripEventSchema.index({ type: 1, capturedAt: -1 });

const DriverTripEventModel = mongoose.model("driver_trip_events", DriverTripEventSchema);

export default DriverTripEventModel;
