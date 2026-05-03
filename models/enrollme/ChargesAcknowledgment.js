import mongoose from "mongoose";
import { signatureSchema } from "./sharedSchemas.js";

const { Schema } = mongoose;

const acknowledgedChargeSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true },
  },
  { _id: false }
);

const ChargesAcknowledgmentSchema = new Schema(
  {
    onboardingId: {
      type: Schema.Types.ObjectId,
      ref: "DriverOnboarding",
      required: true,
      unique: true,
      index: true,
    },
    charges: { type: [acknowledgedChargeSchema], default: [] },
    acknowledgedAll: { type: Boolean, default: false },
    driverSignature: signatureSchema,
    signedAt: { type: Date },
  },
  { timestamps: true }
);

const ChargesAcknowledgment = mongoose.model("ChargesAcknowledgment", ChargesAcknowledgmentSchema);
export default ChargesAcknowledgment;
