import mongoose from "mongoose";
import { signatureSchema } from "./sharedSchemas.js";

const { Schema } = mongoose;

const TrainingAcknowledgmentSchema = new Schema(
  {
    onboardingId: { type: Schema.Types.ObjectId, ref: "DriverOnboarding", required: true, unique: true, index: true },
    acknowledgmentText: { type: String, required: true, trim: true },
    confirmsReviewedAgreement: { type: Boolean, default: false },
    confirmsCompletedQuiz: { type: Boolean, default: false },
    confirmsReceivedTraining: { type: Boolean, default: false },
    confirmsPolicyReview: { type: Boolean, default: false },
    confirmsOpportunityForQuestions: { type: Boolean, default: false },
    driverSignature: signatureSchema,
    signedAt: { type: Date },
  },
  { timestamps: true }
);

const TrainingAcknowledgment = mongoose.model("TrainingAcknowledgment", TrainingAcknowledgmentSchema);
export default TrainingAcknowledgment;
