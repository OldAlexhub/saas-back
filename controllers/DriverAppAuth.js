import jwt from "jsonwebtoken";
import DriverModel from "../models/DriverSchema.js";
import ActiveModel from "../models/ActiveSchema.js";
import config from "../config/index.js";

function normalizeEmail(email) {
  if (!email) return null;
  const trimmed = String(email).trim().toLowerCase();
  if (!trimmed.includes('@')) return null;
  return trimmed;
}

function normalizeDriverId(value) {
  if (!value) return null;
  return String(value).trim();
}

function normalizePhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/[^0-9]/g, "");
  return digits.length >= 7 ? digits : null;
}

function buildLookup({ identifier, email, driverId, phoneNumber }) {
  const or = [];
  const normalizedEmail = normalizeEmail(email);
  const normalizedDriverId = normalizeDriverId(driverId);
  const normalizedPhone = normalizePhone(phoneNumber);

  if (normalizedEmail) or.push({ email: normalizedEmail });
  if (normalizedDriverId) or.push({ driverId: normalizedDriverId });
  if (normalizedPhone) or.push({ phoneNumber: normalizedPhone });

  if (identifier) {
    const trimmed = String(identifier).trim();
    const maybeEmail = normalizeEmail(trimmed);
    const maybePhone = normalizePhone(trimmed);
    if (maybeEmail) or.push({ email: maybeEmail });
    if (maybePhone) or.push({ phoneNumber: maybePhone });
    if (!maybeEmail && !maybePhone) {
      or.push({ driverId: trimmed });
    }
  }

  if (or.length === 0) return null;
  return { $or: or };
}

function sanitizeDriver(driver) {
  if (!driver) return null;
  const plain = typeof driver.toObject === "function" ? driver.toObject() : { ...driver };
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

export const loginDriver = async (req, res) => {
  try {
    const { identifier, email, driverId, phoneNumber, password, deviceId, pushToken } = req.body || {};

    if (!password) {
      return res.status(400).json({ message: "Password is required." });
    }

    const lookup = buildLookup({ identifier, email, driverId, phoneNumber });
    if (!lookup) {
      return res
        .status(400)
        .json({ message: "Provide email, driverId, phoneNumber or identifier for login." });
    }

    const driver = await DriverModel.findOne(lookup).select("+driverApp.passwordHash");
    if (!driver) {
      console.warn("Driver app login: lookup failed", lookup);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    if (!driver.driverApp || !driver.driverApp.passwordHash) {
      console.warn("Driver app login: password not configured", driver.driverId);
      return res
        .status(403)
        .json({ message: "Driver mobile access has not been configured. Contact dispatch." });
    }

    const valid = await driver.verifyAppPassword(password);
    if (!valid) {
      console.warn("Driver app login: bad password", driver.driverId);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const activeRecord = await ActiveModel.findOne({
      driverId: driver.driverId,
    });

    if (!activeRecord || !activeRecord.cabNumber) {
      return res.status(403).json({
        message:
          "Dispatch must pair you with a vehicle before you can sign in. Contact the control center for assistance.",
      });
    }

    const rosterStatus = activeRecord.status ? String(activeRecord.status).toLowerCase() : "";
    const historyChanges = [];
    if (rosterStatus !== "active") {
      const previousStatus = activeRecord.status || null;
      activeRecord.status = "Active";
      historyChanges.push({
        field: "status",
        oldValue: previousStatus,
        newValue: "Active",
      });
    }

    if (!activeRecord.availability) {
      activeRecord.availability = "Offline";
      historyChanges.push({
        field: "availability",
        oldValue: null,
        newValue: "Offline",
      });
    }

    if (historyChanges.length) {
      if (!activeRecord.history) activeRecord.history = [];
      activeRecord.history.push({
        changedBy: driver.driverId,
        note: "Auto activation on driver login",
        changes: historyChanges,
        changedAt: new Date(),
      });
    }

    if (historyChanges.length) {
      console.info(
        "Driver app login: auto-updated roster",
        driver.driverId,
        historyChanges
          .map((change) => `${change.field}:${change.oldValue ?? "null"}->${change.newValue}`)
          .join(", "),
      );
      await activeRecord.save();
    }

    const token = jwt.sign({ driverId: driver._id.toString() }, config.driverJwt.secret, {
      expiresIn: config.driverJwt.expiresIn,
    });

    if (!driver.driverApp) driver.driverApp = {};
    driver.driverApp.lastLoginAt = new Date();
    if (deviceId !== undefined) driver.driverApp.deviceId = deviceId ? String(deviceId) : undefined;
    if (pushToken !== undefined) driver.driverApp.pushToken = pushToken ? String(pushToken) : undefined;
    await driver.save();

    return res.status(200).json({
      message: "Login successful.",
      token,
      driver: sanitizeDriver(driver),
    });
  } catch (error) {
    console.error("Driver login error:", error);
    return res.status(500).json({ message: "Server error while logging in." });
  }
};

export const logoutDriver = async (req, res) => {
  try {
    if (req.driverDoc) {
      if (!req.driverDoc.driverApp) req.driverDoc.driverApp = {};
      req.driverDoc.driverApp.lastLogoutAt = new Date();

      const deviceId = req.body?.deviceId;
      if (deviceId && req.driverDoc.driverApp.deviceId === deviceId) {
        req.driverDoc.driverApp.deviceId = undefined;
      }

      await req.driverDoc.save();
    }

    return res.status(200).json({ message: "Logged out successfully." });
  } catch (error) {
    console.error("Driver logout error:", error);
    return res.status(500).json({ message: "Server error while logging out." });
  }
};

export const changeDriverPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!newPassword || String(newPassword).trim().length < 8) {
      return res
        .status(400)
        .json({ message: "New password must be at least 8 characters long." });
    }

    const driver = await DriverModel.findById(req.driver.id).select("+driverApp.passwordHash");
    if (!driver || !driver.driverApp || !driver.driverApp.passwordHash) {
      return res.status(404).json({ message: "Driver credentials not found." });
    }

    if (!currentPassword) {
      return res.status(400).json({ message: "Current password is required." });
    }

    const valid = await driver.verifyAppPassword(currentPassword);
    if (!valid) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    await driver.setAppPassword(newPassword, { forceReset: false });
    if (!driver.driverApp) driver.driverApp = {};
    driver.driverApp.lastLoginAt = new Date();
    await driver.save();

    return res.status(200).json({ message: "Password updated successfully." });
  } catch (error) {
    console.error("Driver password change error:", error);
    return res.status(500).json({ message: "Server error while updating password." });
  }
};
