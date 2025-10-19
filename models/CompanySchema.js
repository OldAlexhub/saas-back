import mongoose from "mongoose";

const COMPANY_ID = "company_profile";

const CompanySchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: COMPANY_ID,
      immutable: true,
    },
    name: { type: String, required: true },
    address: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    website: { type: String, default: "" },
    logoUrl: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

const CompanyModel = mongoose.model("company", CompanySchema);

export { CompanyModel, COMPANY_ID };
