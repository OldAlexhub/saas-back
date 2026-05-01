import mongoose from "mongoose";

const { Schema } = mongoose;

const AuditLogSchema = new Schema(
  {
    onboardingId: { type: Schema.Types.ObjectId, ref: "DriverOnboarding", index: true },
    actorType: {
      type: String,
      enum: ["admin", "driver", "system"],
      required: true,
      index: true,
    },
    actorAdminId: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
    actorLabel: { type: String, trim: true },
    action: { type: String, required: true, trim: true, index: true },
    documentType: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: true }
);

AuditLogSchema.index({ onboardingId: 1, createdAt: -1 });

const AuditLog = mongoose.model("AuditLog", AuditLogSchema);
export default AuditLog;
