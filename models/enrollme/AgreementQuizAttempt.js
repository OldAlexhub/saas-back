import mongoose from "mongoose";
import { AGREEMENT_VERSION } from "../../constants/enrollme.js";
import { signatureSchema } from "./sharedSchemas.js";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const quizAnswerSchema = new Schema(
  {
    questionId: { type: String, required: true, trim: true },
    answer: { type: Mixed },
    correct: { type: Boolean, default: false },
    answeredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AgreementQuizAttemptSchema = new Schema(
  {
    onboardingId: { type: Schema.Types.ObjectId, ref: "DriverOnboarding", required: true, unique: true, index: true },
    agreementVersion: { type: String, default: AGREEMENT_VERSION },
    questions: { type: [Mixed], default: [] },
    answers: { type: [quizAnswerSchema], default: [] },
    wrongAnswers: { type: [Mixed], default: [] },
    explanationsShown: { type: [Mixed], default: [] },
    passed: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    completedAt: { type: Date },
    attempts: { type: Number, default: 0 },
    acknowledgmentText: { type: String, trim: true },
    driverSignature: signatureSchema,
    signedAt: { type: Date },
  },
  { timestamps: true }
);

const AgreementQuizAttempt = mongoose.model("AgreementQuizAttempt", AgreementQuizAttemptSchema);
export default AgreementQuizAttempt;
