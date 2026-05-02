import mongoose from "mongoose";

const DocumentTemplateSchema = new mongoose.Schema(
  {
    documentType: { type: String, required: true, unique: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    purpose: { type: String, trim: true },
    originalFilePath: { type: String, required: true, trim: true },
    originalFileName: { type: String, required: true, trim: true },
    requiredDefault: { type: Boolean, default: false },
    isFillableOnline: { type: Boolean, default: false },
    isGeneratedBySystem: { type: Boolean, default: false },
    isAdminTrackedExternally: { type: Boolean, default: false },
    isConditional: { type: Boolean, default: false },
    isBlankDownloadable: { type: Boolean, default: true },
    version: { type: String, trim: true },
    active: { type: Boolean, default: true },
    notes: { type: String, trim: true },
    complianceReminder: { type: String, trim: true },
  },
  { timestamps: true }
);

const DocumentTemplate = mongoose.model("DocumentTemplate", DocumentTemplateSchema);
export default DocumentTemplate;
