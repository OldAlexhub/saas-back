import FlatRateModel from "../models/FlatRateSchema.js";
import { diffChanges } from "../utils/diff.js";

function sanitize(flat) {
  if (!flat) return null;
  const obj = typeof flat.toObject === "function" ? flat.toObject() : { ...flat };
  delete obj.__v;
  return obj;
}

export const listFlatRates = async (req, res) => {
  try {
    const { active, includeInactive } = req.query || {};
    const query = {};

    if (active !== undefined) {
      query.active = active === "true";
    } else if (!includeInactive) {
      query.active = true;
    }

    const docs = await FlatRateModel.find(query).sort({ priority: -1, amount: 1 });
    return res.status(200).json({ count: docs.length, flatRates: docs.map(sanitize) });
  } catch (error) {
    console.error("Flat rate list error:", error);
    return res.status(500).json({ message: "Failed to list flat rates." });
  }
};

export const createFlatRate = async (req, res) => {
  try {
    const payload = buildPayload(req.body, { requireName: true, requireAmount: true });
    payload.createdBy = req.user?.id || req.admin?._id?.toString() || "system";
    payload.updatedBy = payload.createdBy;

    const doc = await FlatRateModel.create(payload);
    return res.status(201).json({ message: "Flat rate created.", flatRate: sanitize(doc) });
  } catch (error) {
    console.error("Flat rate create error:", error);
    return res.status(500).json({ message: error.message || "Failed to create flat rate." });
  }
};

export const updateFlatRate = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = buildPayload(req.body);
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    const doc = await FlatRateModel.findById(id);
    if (!doc) {
      return res.status(404).json({ message: "Flat rate not found." });
    }

    const before = doc.toObject();
    Object.assign(doc, payload, { updatedBy: req.user?.id || req.admin?._id?.toString() || "system" });
    await doc.save();

    const after = doc.toObject();
    const changes = diffChanges(before, after);

    return res
      .status(200)
      .json({ message: "Flat rate updated.", flatRate: sanitize(doc), changes });
  } catch (error) {
    console.error("Flat rate update error:", error);
    return res.status(500).json({ message: error.message || "Failed to update flat rate." });
  }
};

export const deleteFlatRate = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await FlatRateModel.findByIdAndDelete(id);
    if (!doc) {
      return res.status(404).json({ message: "Flat rate not found." });
    }
    return res.status(200).json({ message: "Flat rate removed." });
  } catch (error) {
    console.error("Flat rate delete error:", error);
    return res.status(500).json({ message: "Failed to delete flat rate." });
  }
};

function buildPayload(body = {}, { requireName = false, requireAmount = false } = {}) {
  const payload = {};
  const {
    name,
    distanceLabel,
    amount,
    active,
  } = body;

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed && requireName) {
      throw new Error("name is required.");
    }
    payload.name = trimmed;
  } else if (requireName) {
    throw new Error("name is required.");
  }

  if (distanceLabel !== undefined) {
    payload.distanceLabel = String(distanceLabel).trim() || undefined;
  }

  if (amount !== undefined) {
    const num = Number(amount);
    if (!Number.isFinite(num) || num < 0) throw new Error("amount must be a positive number.");
    payload.amount = num;
  } else if (requireAmount) {
    throw new Error("amount is required.");
  }

  if (active !== undefined) payload.active = Boolean(active);

  return payload;
}
