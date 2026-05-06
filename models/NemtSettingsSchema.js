import mongoose from "mongoose";

const NEMT_SETTINGS_ID = "nemt_settings";

const NemtSettingsSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: NEMT_SETTINGS_ID,
      immutable: true,
    },

    // OTP thresholds — names match what NemtReports and NemtDriverApp controllers read
    otpOnTimeMaxMinutes: { type: Number, default: 15 },
    otpLateMaxMinutes: { type: Number, default: 30 },

    // Default pickup windows applied when not specified on individual trips
    defaultPickupWindowMinutesBefore: { type: Number, default: 15 },
    defaultPickupWindowMinutesAfter: { type: Number, default: 30 },

    // Optimization parameters
    appointmentBufferMinutes: { type: Number, default: 15 },
    maxDeviationMiles: { type: Number, default: 5 },
    clusterWindowMinutes: { type: Number, default: 20 },

    // Manifest behavior
    requireDriverAcknowledgement: { type: Boolean, default: true },
    manifestCutoffMinutes: { type: Number, default: 60 },
    allowReoptimizeAfterDispatch: { type: Boolean, default: true },

    // Default driver pay rules (applied when creating trips without explicit pay fields)
    defaultPayBasis: {
      type: String,
      enum: ["per_trip", "per_mile", "percentage"],
      default: "percentage",
    },
    defaultPayRatePerTrip: { type: Number, default: 0 },
    defaultPayRatePerMile: { type: Number, default: 0 },
    defaultPayPercentage: { type: Number, default: 0, min: 0, max: 100 },

    // Whether drivers can see the finance screen in the app
    showDriverFinance: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

const NemtSettingsModel = mongoose.model("nemtsettings", NemtSettingsSchema);
export { NEMT_SETTINGS_ID, NemtSettingsModel };
