import { z } from "zod";
import {
  ADMIN_COMPLIANCE_CHECKLIST_STATUSES,
  DEFAULT_OPTIONAL_DOCUMENTS,
  DEFAULT_REQUIRED_DOCUMENTS,
  DRIVER_ONBOARDING_STATUSES,
  ENROLLME_ADMIN_ROLES,
} from "../constants/enrollme.js";

const optionalString = z.string().trim().optional().or(z.literal(""));
const documentList = z.array(z.string().trim().min(1)).optional();

export const enrollmeAdminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
});

export const enrollmeCreateDriverSchema = z.object({
  driverFirstName: z.string().trim().min(1),
  driverMiddleName: optionalString,
  driverLastName: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  phone: optionalString,
  tokenExpirationDays: z.coerce.number().int().min(1).max(90).optional(),
  requiredDocuments: documentList.default(DEFAULT_REQUIRED_DOCUMENTS),
  optionalDocuments: documentList.default(DEFAULT_OPTIONAL_DOCUMENTS),
  configuration: z
    .object({
      includeWc43: z.boolean().optional(),
      cdlRequired: z.boolean().optional(),
      requireVehicleInspection: z.boolean().optional(),
      requirePreventiveMaintenance: z.boolean().optional(),
      wheelchairAccessible: z.boolean().optional(),
      allowExpiredLicenseException: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

export const enrollmeStatusSchema = z.object({
  status: z.enum(DRIVER_ONBOARDING_STATUSES),
  note: optionalString,
});

export const enrollmeCorrectionSchema = z.object({
  message: z.string().trim().min(1),
  fields: z.array(z.string().trim()).optional().default([]),
});

export const enrollmeNoteSchema = z.object({
  note: z.string().trim().min(1),
});

export const enrollmeSaveStepSchema = z.object({
  step: z.string().trim().min(1),
  data: z.record(z.string(), z.any()).default({}),
});

export const enrollmeSignatureSchema = z.object({
  documentType: z.string().trim().min(1),
  documentTitle: z.string().trim().min(1),
  documentVersion: z.string().trim().min(1),
  effectiveDate: optionalString,
  generatedAt: z.string().trim().min(1),
  reviewedAt: z.string().trim().min(1),
  dataSnapshot: z.any().optional(),
  contentSnapshot: z.string().trim().min(20),
  contentHash: z.string().trim().min(8),
  signerName: z.string().trim().min(1),
  typedSignature: optionalString,
  drawnSignature: optionalString,
  acknowledgmentText: z.string().trim().min(1),
  electronicSignatureConsent: z.literal(true),
  accepted: z.literal(true),
  step: z.string().trim().optional(),
  data: z.record(z.string(), z.any()).optional().default({}),
});

export const enrollmeDocumentReviewSchema = z.object({
  documentType: z.string().trim().min(1),
  documentTitle: z.string().trim().min(1),
  documentVersion: z.string().trim().min(1),
  effectiveDate: optionalString,
  generatedAt: z.string().trim().min(1),
  reviewedAt: z.string().trim().min(1),
  dataSnapshot: z.any().optional(),
  contentSnapshot: z.string().trim().min(20),
  contentHash: z.string().trim().min(8),
});

export const enrollmeQuizAnswerSchema = z.object({
  questionId: z.string().trim().min(1),
  answer: z.any(),
});

export const enrollmeFinalAcknowledgmentSchema = z.object({
  documentType: z.string().trim().min(1),
  documentTitle: z.string().trim().min(1),
  documentVersion: z.string().trim().min(1),
  effectiveDate: optionalString,
  generatedAt: z.string().trim().min(1),
  reviewedAt: z.string().trim().min(1),
  dataSnapshot: z.any().optional(),
  contentSnapshot: z.string().trim().min(20),
  contentHash: z.string().trim().min(8),
  acknowledgmentText: z.string().trim().min(1),
  confirmsReviewedAgreement: z.literal(true),
  confirmsCompletedQuiz: z.literal(true),
  confirmsReceivedTraining: z.literal(true),
  confirmsPolicyReview: z.literal(true),
  confirmsOpportunityForQuestions: z.literal(true),
  signerName: z.string().trim().min(1),
  typedSignature: optionalString,
  drawnSignature: optionalString,
  electronicSignatureConsent: z.literal(true),
});

export const enrollmeSettingsSchema = z.object({
  wc43DefaultRequired: z.boolean().optional(),
  cdlEmploymentHistoryDefaultRequired: z.boolean().optional(),
  tokenExpirationDays: z.coerce.number().int().min(1).max(90).optional(),
  requiredDocuments: documentList.optional(),
  optionalDocuments: documentList.optional(),
});

export const enrollmeSeedAdminSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  role: z.enum(ENROLLME_ADMIN_ROLES).default("super_admin"),
});

export const enrollmeCreateAdminSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  role: z.enum(ENROLLME_ADMIN_ROLES).default("reviewer"),
});

export const enrollmeUpdateAdminSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(ENROLLME_ADMIN_ROLES).optional(),
  isActive: z.boolean().optional(),
});

export const enrollmeAdminChecklistSchema = z.object({
  key: z.string().trim().min(1),
  status: z.enum(ADMIN_COMPLIANCE_CHECKLIST_STATUSES),
  notes: optionalString,
  expiresAt: optionalString,
});
