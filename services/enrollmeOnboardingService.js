import { COMPLIANCE_CHECKLIST_ITEMS, ENROLLME_DOCUMENT_TYPES } from "../constants/enrollme.js";
import DriverOnboarding from "../models/enrollme/DriverOnboarding.js";
import EnrollmeSettings from "../models/enrollme/EnrollmeSettings.js";
import { hashOnboardingToken } from "./enrollmeTokenService.js";

const ADMIN_COMPLETE_STATUSES = new Set(["not_applicable", "verified"]);
const ADMIN_MANAGED_DOCUMENT_TYPES = new Set([
  ENROLLME_DOCUMENT_TYPES.WC43_REJECTION,
  ENROLLME_DOCUMENT_TYPES.VEHICLE_INSPECTION,
  ENROLLME_DOCUMENT_TYPES.PREVENTIVE_MAINTENANCE,
]);

export async function getEnrollmeSettings() {
  return EnrollmeSettings.findOneAndUpdate(
    { singletonKey: "global" },
    { $setOnInsert: { singletonKey: "global" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

export function computeMissingDocuments(requiredDocuments = [], completedDocuments = []) {
  const completed = new Set(completedDocuments);
  return requiredDocuments.filter((documentType) => !ADMIN_MANAGED_DOCUMENT_TYPES.has(documentType) && !completed.has(documentType));
}

function isChecklistItemRequired(item, configuration = {}) {
  if (item.appliesWhen) return Boolean(configuration?.[item.appliesWhen]);
  return Boolean(item.requiredDefault);
}

export function buildAdminComplianceChecklist(configuration = {}, existingItems = []) {
  const existing = new Map((existingItems || []).map((item) => [item.key, item]));

  return COMPLIANCE_CHECKLIST_ITEMS.map((definition) => {
    const current = existing.get(definition.key) || {};
    const required = isChecklistItemRequired(definition, configuration);
    return {
      key: definition.key,
      label: definition.label,
      category: definition.category,
      required,
      status: current.status || (required ? "pending" : "not_applicable"),
      notes: current.notes || "",
      expiresAt: current.expiresAt,
      updatedBy: current.updatedBy,
      updatedAt: current.updatedAt,
    };
  });
}

export function computePacketReadiness(onboarding) {
  const missingDriverDocuments = computeMissingDocuments(
    onboarding?.requiredDocuments || [],
    onboarding?.completedDocuments || []
  );
  const checklist = buildAdminComplianceChecklist(
    onboarding?.configuration || {},
    onboarding?.adminComplianceChecklist || []
  );
  const adminItemsPending = checklist.filter((item) => item.required && !ADMIN_COMPLETE_STATUSES.has(item.status));
  const driverSideComplete = missingDriverDocuments.length === 0;
  const adminChecklistComplete = adminItemsPending.length === 0;

  return {
    driverSideComplete,
    adminChecklistComplete,
    governmentReady: driverSideComplete && adminChecklistComplete,
    canDriverSubmit: driverSideComplete,
    canApproveToOperate: driverSideComplete && adminChecklistComplete,
    missingDriverDocuments,
    adminItemsPending,
    checklist,
  };
}

export function nextStatusForReadiness(onboarding) {
  const readiness = computePacketReadiness(onboarding);
  if (!readiness.driverSideComplete) return onboarding.status;
  return readiness.adminChecklistComplete ? "government_ready" : "admin_items_pending";
}

export async function markOnboardingDocumentComplete(onboardingId, documentType) {
  const onboarding = await DriverOnboarding.findById(onboardingId);
  if (!onboarding) return null;
  if (!onboarding.completedDocuments.includes(documentType)) {
    onboarding.completedDocuments.push(documentType);
  }
  onboarding.missingDocuments = computeMissingDocuments(onboarding.requiredDocuments, onboarding.completedDocuments);
  if (["invited", "draft", "correction_requested"].includes(onboarding.status)) {
    onboarding.status = "in_progress";
  }
  await onboarding.save();
  return onboarding;
}

export async function refreshOnboardingReadiness(onboardingId) {
  const onboarding = await DriverOnboarding.findById(onboardingId);
  if (!onboarding) return null;
  onboarding.adminComplianceChecklist = buildAdminComplianceChecklist(
    onboarding.configuration,
    onboarding.adminComplianceChecklist
  );
  onboarding.missingDocuments = computeMissingDocuments(onboarding.requiredDocuments, onboarding.completedDocuments);
  if (
    onboarding.submittedAt &&
    ["driver_submitted", "admin_items_pending", "admin_review_pending", "government_ready", "submitted"].includes(onboarding.status)
  ) {
    onboarding.status = nextStatusForReadiness(onboarding);
  }
  await onboarding.save();
  return onboarding;
}

export async function refreshOnboardingMissingDocuments(onboardingId) {
  const onboarding = await DriverOnboarding.findById(onboardingId);
  if (!onboarding) return null;
  onboarding.missingDocuments = computeMissingDocuments(onboarding.requiredDocuments, onboarding.completedDocuments);
  await onboarding.save();
  return onboarding;
}

export async function resolveOnboardingByToken(token) {
  const tokenHash = hashOnboardingToken(token);
  const onboarding = await DriverOnboarding.findOne({ onboardingTokenHash: tokenHash }).select("+onboardingTokenHash");
  if (!onboarding) {
    const err = new Error("Onboarding link not found.");
    err.statusCode = 404;
    throw err;
  }

  if (onboarding.tokenExpiresAt && onboarding.tokenExpiresAt.getTime() < Date.now()) {
    const err = new Error("Onboarding link has expired.");
    err.statusCode = 410;
    throw err;
  }

  if (["approved", "approved_to_operate", "rejected", "archived"].includes(onboarding.status)) {
    const err = new Error("Onboarding link is no longer active.");
    err.statusCode = 403;
    throw err;
  }

  return onboarding;
}

export function buildRequiredDocumentsFromConfiguration(settings, configuration = {}, requiredDocuments) {
  const required = new Set(requiredDocuments?.length ? requiredDocuments : settings.requiredDocuments);
  const optional = new Set(settings.optionalDocuments || []);

  if (configuration.includeWc43 || settings.wc43DefaultRequired) {
    required.delete(ENROLLME_DOCUMENT_TYPES.WC43_REJECTION);
    optional.add(ENROLLME_DOCUMENT_TYPES.WC43_REJECTION);
  }
  if (configuration.requireVehicleInspection) {
    required.delete(ENROLLME_DOCUMENT_TYPES.VEHICLE_INSPECTION);
    optional.add(ENROLLME_DOCUMENT_TYPES.VEHICLE_INSPECTION);
  }
  if (configuration.requirePreventiveMaintenance) {
    required.delete(ENROLLME_DOCUMENT_TYPES.PREVENTIVE_MAINTENANCE);
    optional.add(ENROLLME_DOCUMENT_TYPES.PREVENTIVE_MAINTENANCE);
  }

  return {
    requiredDocuments: [...required].filter((documentType) => !ADMIN_MANAGED_DOCUMENT_TYPES.has(documentType)),
    optionalDocuments: [...optional],
  };
}
