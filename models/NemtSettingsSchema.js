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

    // Auto-assignment: only consider drivers who are currently Online
    onlineDriversOnly: { type: Boolean, default: true },

    // Dispatch: block dispatching to drivers who are Offline
    blockDispatchToOfflineDrivers: { type: Boolean, default: false },

    // Dispatch: require a cab number before allowing dispatch
    requireCabBeforeDispatch: { type: Boolean, default: false },

    // Optimization: assumed average speed (mph) for travel-time estimates
    avgMphForOptimization: { type: Number, default: 25, min: 5, max: 120 },

    // Default max trips per run used by auto-assign when not overridden by caller
    defaultMaxTripsPerRun: { type: Number, default: 12, min: 1, max: 40 },

    // Service time (minutes) spent at each stop by mobility type
    serviceTimeByMobility: {
      ambulatory:    { type: Number, default: 3,  min: 0 },
      wheelchair:    { type: Number, default: 8,  min: 0 },
      wheelchair_xl: { type: Number, default: 10, min: 0 },
      stretcher:     { type: Number, default: 12, min: 0 },
    },
  },
  { timestamps: true, versionKey: false }
);

const NemtSettingsModel = mongoose.model("nemtsettings", NemtSettingsSchema);
export { NEMT_SETTINGS_ID, NemtSettingsModel };
