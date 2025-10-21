import mongoose from "mongoose";

const DriverLocationTimelineSchema = new mongoose.Schema(
  {
  driverId: { type: String, required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "bookings" },
    tripSource: { type: String, enum: ["dispatch", "driver"], default: "dispatch" },
    point: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
      },
    },
    speed: { type: Number },
    heading: { type: Number },
    accuracy: { type: Number },
  capturedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  },
);

DriverLocationTimelineSchema.index({ point: "2dsphere" });
DriverLocationTimelineSchema.index({ driverId: 1 });
DriverLocationTimelineSchema.index({ capturedAt: -1 });

const DriverLocationTimelineModel = mongoose.model(
  "driver_location_timeline",
  DriverLocationTimelineSchema,
);

export default DriverLocationTimelineModel;
