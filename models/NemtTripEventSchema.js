import mongoose from "mongoose";

const NemtTripEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, trim: true },
    driverId: { type: String, required: true, trim: true },
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: "nemttrips", required: true },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: "nemtruns" },
    type: { type: String, required: true, trim: true },
    capturedAt: { type: Date, required: true, default: Date.now },
    receivedAt: { type: Date, required: true, default: Date.now },
    payload: { type: mongoose.Schema.Types.Mixed },
    source: { type: String, default: "driverApp" },
  },
  { timestamps: true }
);

NemtTripEventSchema.index({ driverId: 1, eventId: 1 }, { unique: true });
NemtTripEventSchema.index({ tripId: 1, capturedAt: 1 });
NemtTripEventSchema.index({ runId: 1, capturedAt: 1 });

const NemtTripEventModel = mongoose.model("nemt_trip_events", NemtTripEventSchema);
export default NemtTripEventModel;
