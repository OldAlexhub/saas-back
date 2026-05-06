import { NEMT_SETTINGS_ID, NemtSettingsModel } from "../models/NemtSettingsSchema.js";

export async function getNemtSettings(req, res) {
  let settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  if (!settings) {
    // Bootstrap defaults on first access
    const doc = new NemtSettingsModel({ _id: NEMT_SETTINGS_ID });
    await doc.save();
    settings = doc.toObject();
  }
  return res.status(200).json({ settings });
}

export async function updateNemtSettings(req, res) {
  const { _id, ...updates } = req.body;
  const settings = await NemtSettingsModel.findByIdAndUpdate(
    NEMT_SETTINGS_ID,
    { $set: updates },
    { new: true, runValidators: true, upsert: true }
  ).lean();
  return res.status(200).json({ settings });
}
