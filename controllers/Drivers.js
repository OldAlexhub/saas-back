import bcrypt from "bcrypt";
import DriverModel from "../models/DriverSchema.js";

// ---- helper constants ----
const DATE_FIELDS_EXPIRY = [
  "dlExpiry",
  "dotExpiry",
  "cbiExpiry",
  "mvrExpiry",
  "fingerPrintsExpiry",
];

function startOfToday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function parseDateSafe(val) {
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function sanitizeDriver(doc) {
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

// ---- validation helper ----
function validateDatesOnCreateOrUpdate(payload, { isCreate = false } = {}) {
  const errors = [];
  const today = startOfToday();

  // --- Validate DOB (must be at least 21 years ago) ---
  if (isCreate || payload.dob !== undefined) {
    const dob = parseDateSafe(payload.dob);
    if (!dob) errors.push("dob is invalid date.");
    else {
      const ageDifMs = today - dob;
      const age = ageDifMs / (1000 * 60 * 60 * 24 * 365.25); // rough years
      if (age < 21) errors.push("Driver must be at least 21 years old.");
    }
  }

  // --- Validate expiry fields ---
  for (const f of DATE_FIELDS_EXPIRY) {
    if (isCreate || payload[f] !== undefined) {
      const d = parseDateSafe(payload[f]);
      if (!d) errors.push(`${f} is invalid date.`);
      else if (d < today) errors.push(`${f} cannot be expired.`);
    }
  }

  return errors;
}

async function hashSsn(ssn) {
  if (!ssn) return null;
  return bcrypt.hash(String(ssn), 12);
}

// ----------------- LIST DRIVERS -----------------
export const listDrivers = async (_req, res) => {
  try {
    const drivers = await DriverModel.find().select("-ssn -history").lean();
    return res.status(200).json({ count: drivers.length, drivers });
  } catch (error) {
    console.error("Error listing drivers:", error);
    return res.status(500).json({ message: "Server error while fetching drivers." });
  }
};

// ----------------- GET DRIVER -------------------
export const getDriverById = async (req, res) => {
  try {
    const { id } = req.params;
    let driver = null;
    // support both Mongo ObjectId and the app's generated driverId (5-digit string)
    if (id && /^[0-9a-fA-F]{24}$/.test(String(id))) {
      driver = await DriverModel.findById(id).select("-ssn -history");
    }
    if (!driver) {
      const candidateDriverId = String(id || "").trim();
      driver =
        candidateDriverId &&
        (await DriverModel.findOne({ driverId: candidateDriverId }).select("-ssn -history"));
    }
    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }
    return res.status(200).json({ driver: sanitizeDriver(driver) });
  } catch (error) {
    console.error("Error fetching driver:", error);
    return res.status(500).json({ message: "Server error while fetching driver." });
  }
};

// ----------------- ADD RECORD -----------------
export const addDriver = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      dlNumber,
      email,
      dob,
      dlExpiry,
      dotExpiry,
      fullAddress,
      ssn,
      phoneNumber,
      cbiExpiry,
      mvrExpiry,
      fingerPrintsExpiry,
    } = req.body;

    // Required field check
    if (
      !firstName ||
      !lastName ||
      !dlNumber ||
      !email ||
      !dob ||
      !dlExpiry ||
      !dotExpiry ||
      !fullAddress ||
      !ssn ||
      !phoneNumber ||
      !cbiExpiry ||
      !mvrExpiry ||
      !fingerPrintsExpiry
    ) {
      return res.status(400).json({ message: "All fields are required." });
    }

    // Validate date logic
    const dateErrors = validateDatesOnCreateOrUpdate(req.body, { isCreate: true });
    if (dateErrors.length) {
      return res.status(400).json({
        message: "Invalid date(s).",
        errors: dateErrors,
      });
    }

    // Prevent duplicates
    const normalizedEmail = String(email).trim().toLowerCase();

    const existingDriver = await DriverModel.findOne({
      $or: [{ email: normalizedEmail }, { dlNumber }],
    });
    if (existingDriver) {
      return res
        .status(400)
        .json({ message: "Driver already exists with this email or license number." });
    }

    const hashedSsn = await hashSsn(ssn);
    const driver = await DriverModel.create({
      firstName,
      lastName,
      dlNumber,
      email: normalizedEmail,
      dob,
      dlExpiry,
      dotExpiry,
      fullAddress,
      ssn: hashedSsn,
      ssnLast4: String(ssn).slice(-4),
      phoneNumber,
      cbiExpiry,
      mvrExpiry,
      fingerPrintsExpiry,
    });

    return res.status(201).json({
      message: "Driver added successfully.",
      driver: sanitizeDriver(driver),
    });
  } catch (error) {
    console.error("Error adding driver:", error);
    return res.status(500).json({ message: "Server error while adding driver." });
  }
};

// ----------------- UPDATE RECORD -----------------
export const updateDriver = async (req, res) => {
  try {
  const { id } = req.params;
  const updateData = { ...req.body };

    // Prevent manual driverId override
    if (updateData.driverId) {
      delete updateData.driverId;
    }

    // Validate date logic for provided fields
    const dateErrors = validateDatesOnCreateOrUpdate(updateData, { isCreate: false });
    if (dateErrors.length) {
      return res.status(400).json({
        message: "Invalid date(s).",
        errors: dateErrors,
      });
    }

    if (updateData.ssn) {
      updateData.ssn = await hashSsn(updateData.ssn);
      updateData.ssnLast4 = String(req.body.ssn).slice(-4);
    }

    if (updateData.email) {
      updateData.email = String(updateData.email).trim().toLowerCase();
    }

    // Support updates by either Mongo ObjectId or the app's driverId
    let updatedDriver = null;
    if (id && /^[0-9a-fA-F]{24}$/.test(String(id))) {
      updatedDriver = await DriverModel.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true, updatedBy: req.user?.email || "admin" }
      ).select("-ssn -history");
    }
    if (!updatedDriver) {
      const candidateDriverId = String(id || "").trim();
      if (candidateDriverId) {
        updatedDriver = await DriverModel.findOneAndUpdate(
          { driverId: candidateDriverId },
          { $set: updateData },
          { new: true, runValidators: true, updatedBy: req.user?.email || "admin" }
        ).select("-ssn -history");
      }
    }

    if (!updatedDriver) {
      return res.status(404).json({ message: "Driver not found." });
    }

    return res.status(200).json({
      message: "Driver record updated successfully.",
      driver: sanitizeDriver(updatedDriver),
    });
  } catch (error) {
    console.error("Error updating driver:", error);
    return res.status(500).json({ message: "Server error while updating driver." });
  }
};

// ----------------- APP CREDENTIALS -----------------
export const setDriverAppCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    const { password, forcePasswordReset, deviceId, pushToken } = req.body || {};

    let driver = null;
    if (id && /^[0-9a-fA-F]{24}$/.test(String(id))) {
      driver = await DriverModel.findById(id).select("-ssn -history +driverApp.passwordHash");
    }
    if (!driver) {
      const candidateDriverId = String(id || "").trim();
      driver =
        candidateDriverId &&
        (await DriverModel.findOne({ driverId: candidateDriverId }).select("-ssn -history +driverApp.passwordHash"));
    }

    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }

    if (password !== undefined) {
      if (!password || password.trim().length < 8) {
        return res
          .status(400)
          .json({ message: "Password must be at least 8 characters long when provided." });
      }
      await driver.setAppPassword(password, {
        forceReset: forcePasswordReset === true,
      });
    } else if (forcePasswordReset !== undefined) {
      if (!driver.driverApp) driver.driverApp = {};
      driver.driverApp.forcePasswordReset = Boolean(forcePasswordReset);
    }

    if (deviceId !== undefined) {
      if (!driver.driverApp) driver.driverApp = {};
      driver.driverApp.deviceId = deviceId ? String(deviceId) : undefined;
    }

    if (pushToken !== undefined) {
      if (!driver.driverApp) driver.driverApp = {};
      driver.driverApp.pushToken = pushToken ? String(pushToken) : undefined;
    }

    await driver.save();

    return res.status(200).json({
      message: "Driver app credentials updated successfully.",
      driver: sanitizeDriver(driver),
    });
  } catch (error) {
    console.error("Error updating driver app credentials:", error);
    return res.status(500).json({ message: "Server error while updating driver app credentials." });
  }
};
