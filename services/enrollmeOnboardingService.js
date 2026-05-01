import { ENROLLME_DOCUMENT_TYPES } from "../constants/enrollme.js";
import DriverOnboarding from "../models/enrollme/DriverOnboarding.js";
import EnrollmeSettings from "../models/enrollme/EnrollmeSettings.js";
import { hashOnboardingToken } from "./enrollmeTokenService.js";

export async function getEnrollmeSettings() {
  return EnrollmeSettings.findOneAndUpdate(
    { singletonKey: "global" },
    { $setOnInsert: { singletonKey: "global" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

export function computeMissingDocuments(requiredDocuments = [], completedDocuments = []) {
  const completed = new Set(completedDocuments);
  return requiredDocuments.filter((documentType) => !completed.has(documentType));
}

export async function markOnboardingDocumentComplete(onboardingId, documentType) {
  const onboarding = await DriverOnboarding.findById(onboardingId);
  if (!onboarding) return null;
  if (!onboarding.completedDocuments.includes(documentType)) {
    onboarding.completedDocuments.push(documentType);
  }
  onboarding.missingDocuments = computeMissingDocuments(onboarding.requiredDocuments, onboarding.completedDocuments);
  if (onboarding.status === "invited" || onboarding.status === "draft" || onboarding.status === "correction_requested") {
    onboarding.status = "in_progress";
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

  if (["approved", "rejected", "archived"].includes(onboarding.status)) {
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
    required.add(ENROLLME_DOCUMENT_TYPES.WC43_REJECTION);
    optional.delete(ENROLLME_DOCUMENT_TYPES.WC43_REJECTION);
  }
  if (configuration.requireVehicleInspection) {
    required.add(ENROLLME_DOCUMENT_TYPES.VEHICLE_INSPECTION);
    optional.delete(ENROLLME_DOCUMENT_TYPES.VEHICLE_INSPECTION);
  }
  if (configuration.requirePreventiveMaintenance) {
    required.add(ENROLLME_DOCUMENT_TYPES.PREVENTIVE_MAINTENANCE);
    optional.delete(ENROLLME_DOCUMENT_TYPES.PREVENTIVE_MAINTENANCE);
  }

  return {
    requiredDocuments: [...required],
    optionalDocuments: [...optional],
  };
}
