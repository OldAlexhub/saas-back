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
      // Administrable dispatch settings that drive automatic assignment behavior.
      dispatchSettings: {
        maxDistanceMiles: { type: Number, default: 6 }, // used as an upper clamp for radial searches
        maxCandidates: { type: Number, default: 20 },
        // distance search steps in miles (e.g. [1,2,3,4,5,6])
        distanceStepsMiles: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
      },
  },
  { timestamps: true, versionKey: false }
);

const CompanyModel = mongoose.model("company", CompanySchema);

export { COMPANY_ID, CompanyModel };

