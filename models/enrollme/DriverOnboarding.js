import mongoose from "mongoose";
import {
  DEFAULT_OPTIONAL_DOCUMENTS,
  DEFAULT_REQUIRED_DOCUMENTS,
  DRIVER_ONBOARDING_STATUSES,
} from "../../constants/enrollme.js";
import { documentReviewEventSchema, fileRefSchema } from "./sharedSchemas.js";

const { Schema } = mongoose;

const correctionRequestSchema = new Schema(
  {
    message: { type: String, required: true, trim: true },
    fields: [{ type: String, trim: true }],
    status: {
      type: String,
      enum: ["open", "resolved"],
      default: "open",
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
    createdAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
  },
  { _id: true }
);

const adminNoteSchema = new Schema(
  {
    note: { type: String, required: true, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const adminComplianceChecklistSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    required: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["not_applicable", "pending", "received_externally", "verified", "expired", "needs_correction"],
      default: "pending",
    },
    notes: { type: String, trim: true },
    expiresAt: { type: Date },
    updatedBy: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
    updatedAt: { type: Date },
  },
  { _id: false }
);

const DriverOnboardingSchema = new Schema(
  {
    driverFirstName: { type: String, required: true, trim: true },
    driverMiddleName: { type: String, trim: true },
    driverLastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true },
    status: {
      type: String,
      enum: DRIVER_ONBOARDING_STATUSES,
      default: "draft",
      index: true,
    },
    onboardingTokenHash: { type: String, required: true, unique: true, select: false, index: true },
    tokenExpiresAt: { type: Date, required: true, index: true },
    tokenOpenedAt: { type: Date },
    currentStep: { type: String, default: "identity" },
    requiredDocuments: { type: [String], default: () => [...DEFAULT_REQUIRED_DOCUMENTS] },
    optionalDocuments: { type: [String], default: () => [...DEFAULT_OPTIONAL_DOCUMENTS] },
    completedDocuments: { type: [String], default: [] },
    missingDocuments: { type: [String], default: () => [...DEFAULT_REQUIRED_DOCUMENTS] },
    configuration: {
      includeWc43: { type: Boolean, default: false },
      cdlRequired: { type: Boolean, default: false },
      requireVehicleInspection: { type: Boolean, default: false },
      requirePreventiveMaintenance: { type: Boolean, default: false },
      wheelchairAccessible: { type: Boolean, default: false },
      allowExpiredLicenseException: { type: Boolean, default: false },
    },
    adminNotes: { type: [adminNoteSchema], default: [] },
    correctionRequests: { type: [correctionRequestSchema], default: [] },
    adminComplianceChecklist: { type: [adminComplianceChecklistSchema], default: [] },
    documentReviewEvents: { type: [documentReviewEventSchema], default: [] },
    // Retained only for legacy data visibility/migration. EnrollMe routes no longer accept file uploads.
    uploadedFiles: { type: [fileRefSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
    inactivatedBy: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
    submittedAt: { type: Date },
    approvedAt: { type: Date },
    rejectedAt: { type: Date },
    archivedAt: { type: Date },
    inactivatedAt: { type: Date },
    chargesAcknowledgedAt: { type: Date },
  },
  { timestamps: true }
);

DriverOnboardingSchema.virtual("driverFullName").get(function driverFullName() {
  return [this.driverFirstName, this.driverMiddleName, this.driverLastName].filter(Boolean).join(" ");
});

DriverOnboardingSchema.set("toJSON", { virtuals: true });
DriverOnboardingSchema.set("toObject", { virtuals: true });

const DriverOnboarding = mongoose.model("DriverOnboarding", DriverOnboardingSchema);
export default DriverOnboarding;
