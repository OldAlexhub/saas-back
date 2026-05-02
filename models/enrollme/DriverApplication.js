import mongoose from "mongoose";
import { metadataSchema, signatureSchema } from "./sharedSchemas.js";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const DriverApplicationSchema = new Schema(
  {
    onboardingId: { type: Schema.Types.ObjectId, ref: "DriverOnboarding", required: true, unique: true, index: true },
    companyInfo: { type: Mixed, default: {} },
    applicant: {
      firstName: { type: String, trim: true },
      middleName: { type: String, trim: true },
      lastName: { type: String, trim: true },
      email: { type: String, lowercase: true, trim: true },
      phone: { type: String, trim: true },
      dateOfBirth: { type: Date },
      ssnEncrypted: { type: String, select: false },
      ssnLast4: { type: String, trim: true },
    },
    address: { type: Mixed, default: {} },
    previousAddresses: { type: [Mixed], default: [] },
    license: {
      number: { type: String, trim: true },
      state: { type: String, trim: true },
      class: { type: String, trim: true },
      endorsements: { type: String, trim: true },
      issueDate: { type: Date },
      expirationDate: { type: Date },
      deniedSuspendedRevoked: { type: Boolean, default: false },
      deniedSuspendedRevokedExplanation: { type: String, trim: true },
    },
    drivingExperience: { type: [Mixed], default: [] },
    accidentsPast3Years: { type: [Mixed], default: [] },
    trafficConvictionsPast3Years: { type: [Mixed], default: [] },
    employmentHistory: { type: [Mixed], default: [] },
    cdlEmploymentHistory10Years: { type: [Mixed], default: [] },
    cdlEmploymentHistoryRequired: { type: Boolean, default: false },
    safetyPerformanceAcknowledgment: {
      acknowledged: { type: Boolean, default: false },
      authorizationTextAccepted: { type: Boolean, default: false },
      priorEmployerReleaseAccepted: { type: Boolean, default: false },
      notes: { type: String, trim: true },
    },
    applicantCertification: {
      certifiedTrueAndComplete: { type: Boolean, default: false },
      understandsFalseStatements: { type: Boolean, default: false },
      date: { type: Date },
    },
    applicantSignature: signatureSchema,
    signedAt: { type: Date },
    metadata: metadataSchema,
  },
  { timestamps: true }
);

const DriverApplication = mongoose.model("DriverApplication", DriverApplicationSchema);
export default DriverApplication;
