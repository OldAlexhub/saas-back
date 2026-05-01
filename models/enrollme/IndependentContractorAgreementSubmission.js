import mongoose from "mongoose";
import { AGREEMENT_VERSION } from "../../constants/enrollme.js";
import { signatureSchema } from "./sharedSchemas.js";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const IndependentContractorAgreementSubmissionSchema = new Schema(
  {
    onboardingId: { type: Schema.Types.ObjectId, ref: "DriverOnboarding", required: true, unique: true, index: true },
    driverIdentity: { type: Mixed, default: {} },
    agreementVersion: { type: String, default: AGREEMENT_VERSION },
    effectiveDate: { type: Date },
    initials: { type: Mixed, default: {} },
    acceptedSections: { type: [String], default: [] },
    policyChecklistInitials: { type: Mixed, default: {} },
    driverSignature: signatureSchema,
    signedAt: { type: Date },
    pdfPath: { type: String, trim: true },
    companySignaturePending: { type: Boolean, default: true },
    companySignature: {
      signerName: { type: String, trim: true },
      title: { type: String, trim: true },
      signatureData: { type: String },
      signedAt: { type: Date },
    },
  },
  { timestamps: true }
);

const IndependentContractorAgreementSubmission = mongoose.model(
  "IndependentContractorAgreementSubmission",
  IndependentContractorAgreementSubmissionSchema
);

export default IndependentContractorAgreementSubmission;
