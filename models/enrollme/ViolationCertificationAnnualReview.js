import mongoose from "mongoose";
import { fileRefSchema, signatureSchema } from "./sharedSchemas.js";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const ViolationCertificationAnnualReviewSchema = new Schema(
  {
    onboardingId: { type: Schema.Types.ObjectId, ref: "DriverOnboarding", required: true, unique: true, index: true },
    driverCertificationRows: { type: [Mixed], default: [] },
    noViolations: { type: Boolean, default: false },
    driverSignature: signatureSchema,
    driverSignedAt: { type: Date },
    motorCarrierName: { type: String, trim: true },
    motorCarrierAddress: { type: String, trim: true },
    mvrUploadedFile: fileRefSchema,
    annualReview: {
      mvrDate: { type: Date },
      reviewedOn: { type: Date },
      reviewResult: { type: String, trim: true },
      actionTaken: { type: String, trim: true },
      reviewedByName: { type: String, trim: true },
      reviewedByTitle: { type: String, trim: true },
      reviewedByAdmin: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
      signature: signatureSchema,
    },
  },
  { timestamps: true }
);

const ViolationCertificationAnnualReview = mongoose.model(
  "ViolationCertificationAnnualReview",
  ViolationCertificationAnnualReviewSchema
);

export default ViolationCertificationAnnualReview;
