import NemtAgencyModel from "../models/NemtAgencySchema.js";
import { saveWithIdRetry } from "../utils/saveWithRetry.js";

export async function listAgencies(req, res) {
  const { status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  const agencies = await NemtAgencyModel.find(filter).sort({ name: 1 }).lean();
  return res.status(200).json({ agencies });
}

export async function createAgency(req, res) {
  const agency = new NemtAgencyModel(req.body);
  await saveWithIdRetry(() => agency.save(), ["agencyId"]);
  return res.status(201).json({ agency: agency.toObject() });
}

export async function getAgencyById(req, res) {
  const agency = await NemtAgencyModel.findById(req.params.id).lean();
  if (!agency) return res.status(404).json({ message: "Agency not found." });
  return res.status(200).json({ agency });
}

export async function updateAgency(req, res) {
  const { history, agencyId, ...updates } = req.body;
  const agency = await NemtAgencyModel.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean();
  if (!agency) return res.status(404).json({ message: "Agency not found." });
  return res.status(200).json({ agency });
}

export async function deactivateAgency(req, res) {
  const agency = await NemtAgencyModel.findByIdAndUpdate(
    req.params.id,
    { $set: { status: "inactive" } },
    { new: true }
  ).lean();
  if (!agency) return res.status(404).json({ message: "Agency not found." });
  return res.status(200).json({ agency });
}
