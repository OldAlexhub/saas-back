import mongoose from "mongoose";

const NemtRunSchema = new mongoose.Schema(
  {
    runId: { type: String, unique: true },
    serviceDate: { type: Date, required: true },
    label: { type: String, trim: true, default: "" },

    driverId: { type: String, trim: true },
    cabNumber: { type: String, trim: true },

    status: {
      type: String,
      enum: ["Unassigned", "Assigned", "Dispatched", "Acknowledged", "Active", "Completed", "Cancelled"],
      default: "Unassigned",
    },

    // Ordered trip manifest
    trips: [{ type: mongoose.Schema.Types.ObjectId, ref: "nemttrips" }],

    // Denormalized counters (updated as trips change status)
    tripCount: { type: Number, default: 0, min: 0 },
    completedCount: { type: Number, default: 0, min: 0 },
    cancelledCount: { type: Number, default: 0, min: 0 },
    noShowCount: { type: Number, default: 0, min: 0 },

    dispatchedAt: { type: Date },
    acknowledgedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },

    cancelReason: { type: String },

    optimizationVersion: { type: Number, default: 0, min: 0 },
    optimizedAt: { type: Date },

    notes: { type: String, default: "" },

    history: [
      {
        at: { type: Date, default: Date.now },
        byUserId: { type: String },
        action: { type: String, required: true },
        before: { type: mongoose.Schema.Types.Mixed },
        after: { type: mongoose.Schema.Types.Mixed },
        note: { type: String },
      },
    ],
  },
  { timestamps: true }
);

NemtRunSchema.pre("save", function (next) {
  if (!this.runId) {
    const suffix = Math.floor(10000 + Math.random() * 90000).toString();
    this.runId = `RUN-${suffix}`;
  }
  next();
});

NemtRunSchema.index({ serviceDate: 1, status: 1 });
NemtRunSchema.index({ driverId: 1, serviceDate: 1 });
NemtRunSchema.index({ cabNumber: 1, serviceDate: 1 });

const NemtRunModel = mongoose.model("nemtruns", NemtRunSchema);
export default NemtRunModel;
