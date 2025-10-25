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
      // List of allowed operating states (US postal codes). Used by the admin UI
      // to indicate where the service is available. This is informational by
      // default; enforcement (geo-fencing, routing) can be added separately.
      allowedStates: { type: [String], default: ["FL"] },
      // Administrable dispatch settings that drive automatic assignment behavior.
      dispatchSettings: {
        maxDistanceMiles: { type: Number, default: 6 }, // used as an upper clamp for radial searches
        maxCandidates: { type: Number, default: 20 },
        // distance search steps in miles (e.g. [1,2,3,4,5,6])
        distanceStepsMiles: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
      },
      // Hours-of-Service (HOS) settings. Admins may update these values to
      // reflect local PUC rules. Defaults are conservative and may be
      // overridden by env or via the company profile update API.
      hosSettings: {
        MAX_ON_DUTY_HOURS: { type: Number, default: 12 },
        REQUIRED_OFF_DUTY_HOURS: { type: Number, default: 12 },
        LOOKBACK_WINDOW_HOURS: { type: Number, default: 24 },
        // retention in months for raw duty records. NOTE: core requirement
        // requested >= 12 months; default set to 12 to ensure compliance.
        RECORD_RETENTION_MONTHS: { type: Number, default: 12 },
        ALLOW_ALTERNATE_RULES: { type: Boolean, default: false },
        ALERT_THRESHOLD_HOURS: { type: Number, default: 11.5 },
      },
  },
  { timestamps: true, versionKey: false }
);

const CompanyModel = mongoose.model("company", CompanySchema);

export { COMPANY_ID, CompanyModel };

