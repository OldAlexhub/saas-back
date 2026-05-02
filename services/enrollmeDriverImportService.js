import DriverModel from "../models/DriverSchema.js";
import DriverApplication from "../models/enrollme/DriverApplication.js";
import DriverOnboarding from "../models/enrollme/DriverOnboarding.js";
import { createDriverRecord, sanitizeDriver, validateDatesOnCreateOrUpdate } from "./driverCreationService.js";
import { decryptSensitiveValue } from "./enrollmeSensitiveDataService.js";
import { computePacketReadiness } from "./enrollmeOnboardingService.js";

const IMPORTABLE_STATUSES = new Set([
  "driver_submitted",
  "admin_items_pending",
  "government_ready",
  "approved_to_operate",
  "submitted",
  "approved",
]);

const CHECKLIST_EXPIRY_MAP = [
  {
    driverField: "mvrExpiry",
    checklistKey: "mvr",
    label: "MVR expiry",
  },
  {
    driverField: "cbiExpiry",
    checklistKey: "background_check",
    label: "CBI/background check expiry",
  },
  {
    driverField: "fingerPrintsExpiry",
    checklistKey: "fingerprint_qualification",
    label: "Fingerprint Card expiry",
  },
  {
    driverField: "dotExpiry",
    checklistKey: "medical_certificate",
    label: "DOT Medical Card expiry",
  },
];

export const ENROLLME_DRIVER_FIELD_MAP = [
  { enrollme: "onboarding.driverFirstName", driver: "firstName", label: "First name" },
  { enrollme: "onboarding.driverLastName", driver: "lastName", label: "Last name" },
  { enrollme: "onboarding.email", driver: "email", label: "Email" },
  { enrollme: "onboarding.phone", driver: "phoneNumber", label: "Phone number" },
  { enrollme: "application.applicant.dateOfBirth", driver: "dob", label: "Date of birth" },
  { enrollme: "application.address", driver: "fullAddress", label: "Residential address" },
  { enrollme: "application.applicant.ssnEncrypted", driver: "ssn", label: "SSN" },
  { enrollme: "application.license.number", driver: "dlNumber", label: "Driver license number" },
  { enrollme: "application.license.expirationDate", driver: "dlExpiry", label: "Driver license expiry" },
  { enrollme: "checklist.medical_certificate.expiresAt", driver: "dotExpiry", label: "DOT Medical Card expiry" },
  { enrollme: "checklist.background_check.expiresAt", driver: "cbiExpiry", label: "CBI/background check expiry" },
  { enrollme: "checklist.mvr.expiresAt", driver: "mvrExpiry", label: "MVR expiry" },
  { enrollme: "checklist.fingerprint_qualification.expiresAt", driver: "fingerPrintsExpiry", label: "Fingerprint Card expiry" },
];

export class EnrollmeDriverImportError extends Error {
  constructor(message, { statusCode = 400, errors = [], candidate = null } = {}) {
    super(message);
    this.name = "EnrollmeDriverImportError";
    this.statusCode = statusCode;
    this.errors = errors;
    this.candidate = candidate;
  }
}

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function isoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatFullAddress(address) {
  if (typeof address === "string") return address.trim();
  if (!address || typeof address !== "object") return "";

  const street = [address.street, address.addressLine1, address.line1].find(isPresent) || "";
  const unit = [address.unit, address.addressLine2, address.line2].find(isPresent) || "";
  const city = address.city || "";
  const state = address.state || "";
  const zip = address.zip || address.postalCode || "";
  const locality = [city, [state, zip].filter(isPresent).join(" ")].filter(isPresent).join(", ");

  return [street, unit, locality].filter(isPresent).join(", ").trim();
}

function publicName(onboarding) {
  return [onboarding?.driverFirstName, onboarding?.driverMiddleName, onboarding?.driverLastName]
    .filter(isPresent)
    .join(" ");
}

function checklistByKey(onboarding) {
  const readiness = computePacketReadiness(onboarding);
  return new Map((readiness.checklist || []).map((item) => [item.key, item]));
}

function addMissing(errors, label) {
  errors.push(`${label} is missing from EnrollMe and is required by the SaaS driver record.`);
}

function addChecklistDate(payload, errors, checklist, mapping) {
  const item = checklist.get(mapping.checklistKey);
  if (!item) {
    addMissing(errors, mapping.label);
    return;
  }

  if (item.status === "expired") {
    errors.push(`${mapping.label} is marked expired in EnrollMe.`);
  } else if (item.status !== "verified") {
    errors.push(`${mapping.label} must be verified in EnrollMe before import.`);
  }

  if (!item.expiresAt) {
    addMissing(errors, mapping.label);
    return;
  }

  const value = isoDate(item.expiresAt);
  if (!value) {
    errors.push(`${mapping.label} is invalid in EnrollMe.`);
    return;
  }
  payload[mapping.driverField] = value;
}

function buildPayloadFromEnrollme(onboarding, application, { includeSensitive = false } = {}) {
  const errors = [];
  const checklist = checklistByKey(onboarding);
  const payload = {
    firstName: onboarding?.driverFirstName || application?.applicant?.firstName || "",
    lastName: onboarding?.driverLastName || application?.applicant?.lastName || "",
    dlNumber: application?.license?.number || "",
    email: onboarding?.email || application?.applicant?.email || "",
    dob: isoDate(application?.applicant?.dateOfBirth),
    dlExpiry: isoDate(application?.license?.expirationDate),
    dotExpiry: "",
    fullAddress: formatFullAddress(application?.address),
    ssn: "",
    phoneNumber: onboarding?.phone || application?.applicant?.phone || "",
    cbiExpiry: "",
    mvrExpiry: "",
    fingerPrintsExpiry: "",
  };

  if (!IMPORTABLE_STATUSES.has(onboarding?.status)) {
    errors.push("EnrollMe application must be completed or approved before it can be imported.");
  }

  const readiness = computePacketReadiness(onboarding);
  if (!readiness.driverSideComplete) {
    errors.push("EnrollMe driver-side packet is not complete.");
  }

  for (const [field, label] of [
    ["firstName", "First name"],
    ["lastName", "Last name"],
    ["email", "Email"],
    ["phoneNumber", "Phone number"],
    ["dob", "Date of birth"],
    ["fullAddress", "Residential address"],
    ["dlNumber", "Driver license number"],
    ["dlExpiry", "Driver license expiry"],
  ]) {
    if (!isPresent(payload[field])) addMissing(errors, label);
  }

  const encryptedSsn = application?.applicant?.ssnEncrypted;
  if (!encryptedSsn) {
    addMissing(errors, "SSN");
  } else if (includeSensitive) {
    try {
      payload.ssn = decryptSensitiveValue(encryptedSsn);
    } catch (_err) {
      errors.push("Stored EnrollMe SSN could not be read. Re-enter SSN in EnrollMe before importing.");
    }
  }

  for (const mapping of CHECKLIST_EXPIRY_MAP) {
    addChecklistDate(payload, errors, checklist, mapping);
  }

  if (includeSensitive && !isPresent(payload.ssn)) {
    addMissing(errors, "SSN");
  }

  const dateErrors = validateDatesOnCreateOrUpdate(
    {
      ...payload,
      ssn: includeSensitive ? payload.ssn : encryptedSsn ? "0000" : "",
    },
    { isCreate: true }
  );
  errors.push(...dateErrors);

  return { payload, errors, hasSsn: Boolean(encryptedSsn) };
}

function publicCandidate(onboarding, application, buildResult, duplicateErrors = []) {
  const errors = [...buildResult.errors, ...duplicateErrors];
  const prefill = { ...buildResult.payload, ssn: "" };

  return {
    id: String(onboarding._id),
    sourceId: String(onboarding._id),
    name: publicName(onboarding),
    email: onboarding.email || application?.applicant?.email || "",
    phone: onboarding.phone || application?.applicant?.phone || "",
    status: onboarding.status,
    submittedAt: onboarding.submittedAt,
    approvedAt: onboarding.approvedAt,
    hasSsn: buildResult.hasSsn,
    canImport: errors.length === 0,
    errors,
    prefill,
  };
}

function duplicateErrorsFor(existingDriver, payload, onboardingId) {
  if (!existingDriver) return [];
  if (String(existingDriver?.enrollmeSource?.onboardingId || "") === String(onboardingId)) {
    return [`EnrollMe application is already linked to SaaS driver ${existingDriver.driverId || existingDriver._id}.`];
  }
  if (
    payload.email &&
    String(existingDriver.email || "").toLowerCase() === String(payload.email).trim().toLowerCase()
  ) {
    return ["A SaaS driver already exists with this EnrollMe email address."];
  }
  if (payload.dlNumber && String(existingDriver.dlNumber || "") === String(payload.dlNumber)) {
    return ["A SaaS driver already exists with this EnrollMe driver license number."];
  }
  return ["A matching SaaS driver already exists."];
}

function findExistingForCandidate(existingDrivers, candidate, payload) {
  return existingDrivers.find((driver) => {
    if (String(driver?.enrollmeSource?.onboardingId || "") === String(candidate._id)) return true;
    if (payload.email && String(driver.email || "").toLowerCase() === String(payload.email).trim().toLowerCase()) return true;
    if (payload.dlNumber && String(driver.dlNumber || "") === String(payload.dlNumber)) return true;
    return false;
  });
}

async function loadExistingDriversForCandidates(buildRows) {
  const or = [];
  for (const row of buildRows) {
    or.push({ "enrollmeSource.onboardingId": row.onboarding._id });
    if (row.build.payload.email) or.push({ email: String(row.build.payload.email).trim().toLowerCase() });
    if (row.build.payload.dlNumber) or.push({ dlNumber: row.build.payload.dlNumber });
  }

  if (!or.length) return [];
  return DriverModel.find({ $or: or })
    .select("driverId email dlNumber enrollmeSource.onboardingId")
    .lean();
}

export async function listEnrollmeDriverImportCandidates({ search = "" } = {}) {
  const query = {
    status: { $in: [...IMPORTABLE_STATUSES] },
    archivedAt: { $exists: false },
  };

  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [
      { driverFirstName: rx },
      { driverMiddleName: rx },
      { driverLastName: rx },
      { email: rx },
      { phone: rx },
    ];
  }

  const onboardings = await DriverOnboarding.find(query)
    .sort({ approvedAt: -1, submittedAt: -1, updatedAt: -1 })
    .limit(100)
    .lean({ virtuals: true });

  const ids = onboardings.map((item) => item._id);
  const applications = await DriverApplication.find({ onboardingId: { $in: ids } })
    .select("+applicant.ssnEncrypted")
    .lean();
  const applicationByOnboardingId = new Map(applications.map((item) => [String(item.onboardingId), item]));

  const buildRows = onboardings.map((onboarding) => ({
    onboarding,
    application: applicationByOnboardingId.get(String(onboarding._id)) || null,
    build: buildPayloadFromEnrollme(
      onboarding,
      applicationByOnboardingId.get(String(onboarding._id)) || null,
      { includeSensitive: false }
    ),
  }));

  const existingDrivers = await loadExistingDriversForCandidates(buildRows);

  return buildRows.map((row) => {
    const existing = findExistingForCandidate(existingDrivers, row.onboarding, row.build.payload);
    return publicCandidate(
      row.onboarding,
      row.application,
      row.build,
      duplicateErrorsFor(existing, row.build.payload, row.onboarding._id)
    );
  });
}

export async function getEnrollmeDriverImportCandidate(onboardingId, { includeSensitive = false } = {}) {
  const [onboarding, application] = await Promise.all([
    DriverOnboarding.findById(onboardingId).lean({ virtuals: true }),
    DriverApplication.findOne({ onboardingId }).select("+applicant.ssnEncrypted").lean(),
  ]);

  if (!onboarding) {
    const err = new EnrollmeDriverImportError("EnrollMe application not found.", { statusCode: 404 });
    throw err;
  }

  const build = buildPayloadFromEnrollme(onboarding, application, { includeSensitive });
  const existingDrivers = await loadExistingDriversForCandidates([{ onboarding, application, build }]);
  const existing = findExistingForCandidate(existingDrivers, onboarding, build.payload);
  const candidate = publicCandidate(
    onboarding,
    application,
    build,
    duplicateErrorsFor(existing, build.payload, onboarding._id)
  );

  return {
    candidate,
    driverPayload: build.payload,
  };
}

export async function importEnrollmeDriverToRoster(onboardingId, { adminEmail = "admin" } = {}) {
  const { candidate, driverPayload } = await getEnrollmeDriverImportCandidate(onboardingId, {
    includeSensitive: true,
  });

  if (!candidate.canImport) {
    throw new EnrollmeDriverImportError("EnrollMe application cannot be imported.", {
      statusCode: 400,
      errors: candidate.errors,
      candidate,
    });
  }

  const driver = await createDriverRecord(driverPayload, {
    sourceMeta: {
      source: "enrollme",
      enrollmeSource: {
        onboardingId,
        importedAt: new Date(),
        importedBy: adminEmail,
      },
    },
    duplicateStatusCode: 409,
    clearDuplicateMessages: true,
  });

  return {
    message: "EnrollMe application imported into the driver roster.",
    driver: sanitizeDriver(driver),
    sourceId: String(onboardingId),
  };
}
