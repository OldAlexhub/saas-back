import mongoose from "mongoose";

// Subdocs for update history
const ChangeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },                 
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const HistoryEntrySchema = new mongoose.Schema(
  {
    changedBy: { type: String },                             
    note: { type: String },                                  
    changes: { type: [ChangeSchema], default: [] },          
    changedAt: { type: Date, default: Date.now },            
  },
  { _id: false }
);

// HOS violation entry
const HosViolationSchema = new mongoose.Schema(
  {
    rule: { type: String },                // e.g., "DailyDrivingLimit", "BreakRequired"
    occurredAt: { type: Date },
    note: { type: String }
  },
  { _id: false }
);

// Main Active schema
const ActiveSchema = new mongoose.Schema({
  driverId:   { type: String, required: true },
  cabNumber:  { type: String, required: true },
  firstName:  { type: String, required: true },
  lastName:   { type: String, required: true },
  licPlates:  { type: String, required: true },
  make:       { type: String },
  model:      { type: String },
  color:      { type: String },
  // Snapshot of key vehicle compliance fields for quick checks on the roster
  regisExpiry: { type: Date },
  annualInspection: { type: Date },
  vehicleCompliance: {
    isCompliant: { type: Boolean, default: true },
    issues: { type: [String], default: [] },
  },

  // Operational status (assignment/roster state)
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  },

  // Availability (real-time app presence; separate from status)
  availability: {
    type: String,
    enum: ['Online', 'Offline'],
    default: 'Offline'
  },

  // Current live location (GeoJSON Point)
  currentLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    },
    updatedAt: { type: Date, default: Date.now }
  },

  // Hours of Service (all values set/maintained by frontend/services; no auto-calcs here)
  hoursOfService: {
    dutyStart: { type: Date },                 // current on-duty window start
    lastBreakStart: { type: Date },
    lastBreakEnd: { type: Date },

    // Daily aggregates (minutes)
    drivingMinutesToday: { type: Number, min: 0 },
    onDutyMinutesToday: { type: Number, min: 0 },
    offDutyMinutesToday: { type: Number, min: 0 },

    // Rolling aggregates (minutes)
    drivingMinutes7d: { type: Number, min: 0 },
    onDutyMinutes7d: { type: Number, min: 0 },

    // Limits (minutes)
    maxDailyDrivingMinutes: { type: Number, min: 0 },
    maxDailyOnDutyMinutes: { type: Number, min: 0 },
    maxWeeklyOnDutyMinutes: { type: Number, min: 0 },

    cycleStart: { type: Date },               // when current HOS cycle began
    lastResetAt: { type: Date },              // last 34h/24h reset (depending on your policy)

  // Cumulative totals persisted server-side so values don't reset on login
  cumulativeDrivingMinutes: { type: Number, min: 0, default: 0 },
  cumulativeOnDutyMinutes: { type: Number, min: 0, default: 0 },
  cumulativeUpdatedAt: { type: Date },

    violations: { type: [HosViolationSchema], default: [] }
  },

  // Generic update history (append entries from controller on each update)
  history: { type: [HistoryEntrySchema], default: [] }
});

// Geospatial index for proximity queries
ActiveSchema.index({ currentLocation: "2dsphere" });

const ActiveModel = mongoose.model("actives", ActiveSchema);

export default ActiveModel;
