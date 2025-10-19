import { FareModel, SINGLETON_ID } from "../models/FareSchema.js";
import FlatRateModel from "../models/FlatRateSchema.js";

// POST /fare  -> create once only
export const addFare = async (req, res) => {
  try {
    const exists = await FareModel.findById(SINGLETON_ID);
    if (exists) {
      return res.status(409).json({
        message: "Fare structure already exists. Use update instead.",
      });
    }

    const payload = buildFarePayload(req.body, { requireRequiredFields: true });
    const doc = await FareModel.create({
      _id: SINGLETON_ID,
      ...payload,
    });

    return res.status(201).json({ message: "Fare structure created.", fare: doc });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to create fare." });
  }
};

function buildFarePayload(body = {}, { requireRequiredFields = false } = {}) {
  const {
    farePerMile,
    extraPass,
    waitTimePerMinute,
    baseFare,
    minimumFare,
    waitTriggerSpeedMph,
    idleGracePeriodSeconds,
    meterRoundingMode,
    surgeEnabled,
    surgeMultiplier,
    surgeNotes,
    otherFees,
  } = body;

  const payload = {};

  function toNumber(value, fieldName, { allowUndefined = true, min = 0 } = {}) {
    if (value === undefined || value === null || value === "") {
      if (allowUndefined) return undefined;
      throw new Error(`${fieldName} is required.`);
    }

    const num = Number(value);
    if (!Number.isFinite(num) || num < min) {
      throw new Error(`${fieldName} must be a number${min > 0 ? ` >= ${min}` : ""}.`);
    }
    return num;
  }

  if (farePerMile !== undefined || requireRequiredFields) {
    payload.farePerMile = toNumber(farePerMile, "farePerMile", { allowUndefined: !requireRequiredFields });
  }

  if (waitTimePerMinute !== undefined || requireRequiredFields) {
    payload.waitTimePerMinute = toNumber(waitTimePerMinute, "waitTimePerMinute", {
      allowUndefined: !requireRequiredFields,
    });
  }

  if (extraPass !== undefined) payload.extraPass = toNumber(extraPass, "extraPass");
  if (baseFare !== undefined) payload.baseFare = toNumber(baseFare, "baseFare");
  if (minimumFare !== undefined) payload.minimumFare = toNumber(minimumFare, "minimumFare");
  if (waitTriggerSpeedMph !== undefined)
    payload.waitTriggerSpeedMph = toNumber(waitTriggerSpeedMph, "waitTriggerSpeedMph");
  if (idleGracePeriodSeconds !== undefined)
    payload.idleGracePeriodSeconds = toNumber(idleGracePeriodSeconds, "idleGracePeriodSeconds");

  if (meterRoundingMode !== undefined) {
    const allowed = ["none", "nearest_0.1", "nearest_0.25", "nearest_0.5", "nearest_1"];
    const normalized = String(meterRoundingMode).trim();
    if (!allowed.includes(normalized)) {
      throw new Error(`meterRoundingMode must be one of ${allowed.join(", ")}.`);
    }
    payload.meterRoundingMode = normalized;
  }

  if (surgeEnabled !== undefined) payload.surgeEnabled = Boolean(surgeEnabled);
  if (surgeMultiplier !== undefined) {
    payload.surgeMultiplier = toNumber(surgeMultiplier, "surgeMultiplier", { min: 0 });
  }

  if (surgeNotes !== undefined) payload.surgeNotes = String(surgeNotes).trim().slice(0, 240) || undefined;

  if (otherFees !== undefined) {
    if (!Array.isArray(otherFees)) {
      throw new Error("otherFees must be an array.");
    }

    const parsed = [];
    otherFees.forEach((fee, index) => {
      if (!fee) return;
      const name = typeof fee.name === "string" ? fee.name.trim() : "";
      const amount = toNumber(fee.amount, `otherFees[${index}].amount`);
      if (!name) {
        throw new Error(`otherFees[${index}].name is required.`);
      }
      parsed.push({ name, amount });
    });

    payload.otherFees = parsed;
  }

  return payload;
}

// PUT /fare  -> update the single record
export const updateFare = async (req, res) => {
  try {
    const payload = buildFarePayload(req.body);

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    const updated = await FareModel.findByIdAndUpdate(
      SINGLETON_ID,
      { $set: payload },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Fare structure not found. Create it first." });
    }

    return res.status(200).json({ message: "Fare structure updated.", fare: updated });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to update fare." });
  }
};

// GET /fare  -> retrieve current fare
export const getFare = async (_req, res) => {
  try {
    const fare = await FareModel.findById(SINGLETON_ID);
    if (!fare) return res.status(404).json({ message: "Fare structure not found." });

    const flatRates = await FlatRateModel.find({ active: true }).sort({ amount: 1, name: 1 });
    return res.status(200).json({
      fare,
      flatRates,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch fare." });
  }
};
