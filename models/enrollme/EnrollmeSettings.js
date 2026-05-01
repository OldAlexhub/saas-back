import mongoose from "mongoose";
import { DEFAULT_OPTIONAL_DOCUMENTS, DEFAULT_REQUIRED_DOCUMENTS } from "../../constants/enrollme.js";

const { Schema } = mongoose;

const EnrollmeSettingsSchema = new Schema(
  {
    singletonKey: { type: String, unique: true, default: "global", immutable: true },
    wc43DefaultRequired: { type: Boolean, default: false },
    cdlEmploymentHistoryDefaultRequired: { type: Boolean, default: false },
    tokenExpirationDays: { type: Number, default: 14, min: 1, max: 90 },
    requiredDocuments: { type: [String], default: () => [...DEFAULT_REQUIRED_DOCUMENTS] },
    optionalDocuments: { type: [String], default: () => [...DEFAULT_OPTIONAL_DOCUMENTS] },
    updatedBy: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
  },
  { timestamps: true }
);

const EnrollmeSettings = mongoose.model("EnrollmeSettings", EnrollmeSettingsSchema);
export default EnrollmeSettings;
