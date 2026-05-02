import bcrypt from "bcrypt";
import DriverModel from "../models/DriverSchema.js";
import { saveWithIdRetry } from "../utils/saveWithRetry.js";
import { createDriverSchema } from "../validators/driverSchemas.js";

const DATE_FIELDS_EXPIRY = [
  "dlExpiry",
  "dotExpiry",
  "cbiExpiry",
  "mvrExpiry",
  "fingerPrintsExpiry",
];

export class DriverCreationError extends Error {
  constructor(message, { statusCode = 400, errors = [] } = {}) {
    super(message);
    this.name = "DriverCreationError";
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

function startOfToday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function parseDateSafe(val) {
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export function sanitizeDriver(doc) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete plain.ssn;
  delete plain.history;
  if (plain.driverApp) {
    const { forcePasswordReset = false, lastLoginAt, lastLogoutAt, deviceId, pushToken } =
      plain.driverApp;
    plain.driverApp = {
      forcePasswordReset: Boolean(forcePasswordReset),
      lastLoginAt: lastLoginAt || null,
      lastLogoutAt: lastLogoutAt || null,
      deviceId: deviceId || null,
      pushToken: pushToken || null,
    };
  }
  return plain;
}

export function validateDatesOnCreateOrUpdate(payload, { isCreate = false } = {}) {
  const errors = [];
  const today = startOfToday();

  if (isCreate || payload.dob !== undefined) {
    const dob = parseDateSafe(payload.dob);
    if (!dob) errors.push("dob is invalid date.");
    else {
      const ageDifMs = today - dob;
      const age = ageDifMs / (1000 * 60 * 60 * 24 * 365.25);
      if (age < 21) errors.push("Driver must be at least 21 years old.");
    }
  }

  for (const f of DATE_FIELDS_EXPIRY) {
    if (isCreate || payload[f] !== undefined) {
      const d = parseDateSafe(payload[f]);
      if (!d) errors.push(`${f} is invalid date.`);
      else if (d < today) errors.push(`${f} cannot be expired.`);
    }
  }

  return errors;
}

export async function hashSsn(ssn) {
  if (!ssn) return null;
  return bcrypt.hash(String(ssn), 12);
}

function formatSchemaErrors(error) {
  return (error.issues || error.errors || []).map((issue) => ({
    field: issue.path?.join(".") || "",
    message: issue.message,
  }));
}

function sameObjectId(a, b) {
  return String(a || "") === String(b || "");
}

function duplicateMessage(existingDriver, payload, sourceMeta, clearDuplicateMessages) {
  const sourceOnboardingId = sourceMeta?.enrollmeSource?.onboardingId;
  if (
    sourceOnboardingId &&
    sameObjectId(existingDriver?.enrollmeSource?.onboardingId, sourceOnboardingId)
  ) {
    return `EnrollMe application is already linked to SaaS driver ${existingDriver.driverId || existingDriver._id}.`;
  }

  if (!clearDuplicateMessages) {
    return "Driver already exists with this email or license number.";
  }

  const normalizedEmail = String(payload.email || "").trim().toLowerCase();
  if (normalizedEmail && String(existingDriver?.email || "").toLowerCase() === normalizedEmail) {
    return "Driver already exists with this email address.";
  }

  if (payload.dlNumber && String(existingDriver?.dlNumber || "") === String(payload.dlNumber)) {
    return "Driver already exists with this driver license number.";
  }

  return "Driver already exists with this email or license number.";
}

export async function createDriverRecord(
  rawPayload,
  { sourceMeta = {}, duplicateStatusCode = 400, clearDuplicateMessages = false } = {}
) {
  const parsed = createDriverSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new DriverCreationError("Validation failed.", {
      statusCode: 400,
      errors: formatSchemaErrors(parsed.error),
    });
  }

  const payload = parsed.data;
  const dateErrors = validateDatesOnCreateOrUpdate(payload, { isCreate: true });
  if (dateErrors.length) {
    throw new DriverCreationError("Invalid date(s).", {
      statusCode: 400,
      errors: dateErrors,
    });
  }

  const normalizedEmail = String(payload.email).trim().toLowerCase();
  const duplicateChecks = [{ email: normalizedEmail }, { dlNumber: payload.dlNumber }];
  if (sourceMeta?.enrollmeSource?.onboardingId) {
    duplicateChecks.push({ "enrollmeSource.onboardingId": sourceMeta.enrollmeSource.onboardingId });
  }

  const existingDriver = await DriverModel.findOne({ $or: duplicateChecks })
    .select("driverId email dlNumber enrollmeSource.onboardingId")
    .lean();
  if (existingDriver) {
    throw new DriverCreationError(duplicateMessage(existingDriver, payload, sourceMeta, clearDuplicateMessages), {
      statusCode: duplicateStatusCode,
    });
  }

  const hashedSsn = await hashSsn(payload.ssn);
  const createPayload = {
    firstName: payload.firstName,
    lastName: payload.lastName,
    dlNumber: payload.dlNumber,
    email: normalizedEmail,
    dob: payload.dob,
    dlExpiry: payload.dlExpiry,
    dotExpiry: payload.dotExpiry,
    fullAddress: payload.fullAddress,
    ssn: hashedSsn,
    ssnLast4: String(payload.ssn).slice(-4),
    phoneNumber: payload.phoneNumber,
    cbiExpiry: payload.cbiExpiry,
    mvrExpiry: payload.mvrExpiry,
    fingerPrintsExpiry: payload.fingerPrintsExpiry,
    ...sourceMeta,
  };

  return saveWithIdRetry(() => DriverModel.create(createPayload), ["driverId"]);
}
