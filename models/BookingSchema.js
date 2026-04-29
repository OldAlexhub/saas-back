import mongoose from "mongoose";

/**
 * Bookings (single-tenant)
 * - Random 5-digit bookingId (immutable)
 * - GeoJSON + lon/lat sync
 * - Simple fare split & status timestamps
 * - Assignment via driverId (String) and/or cabNumber (String) validated against Active
 * - Lightweight audit history
 */

const BookingSchema = new mongoose.Schema(
  {
    // Identity
    bookingId: { type: Number, unique: true }, // 5-digit, assigned in pre-save

    // Rider & trip core
    customerName: { type: String, required: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },

    // Pickup (required)
    pickupAddress: { type: String, required: true, trim: true },
    pickupTime: { type: Date, required: true },

    // Dropoff (optional)
    dropoffAddress: { type: String, trim: true },

    // Coordinates (numeric pairs)
    pickupLon: { type: Number },
    pickupLat: { type: Number },
    dropoffLon: { type: Number },
    dropoffLat: { type: Number },

    // GeoJSON points (for near/dispatch queries)
    pickupPoint: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: undefined }, // [lon, lat]
    },
    dropoffPoint: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: undefined },
    },

    // Trip details
    passengers: { type: Number, default: 1, min: 1 },

    // Fare (estimate vs actual)
    estimatedFare: { type: Number },
    finalFare: { type: Number },
    estimatedDistanceMiles: { type: Number, min: 0 },
    estimatedDistanceSource: {
      type: String,
      enum: ["driving", "straight-line", "computed", "manual"],
    },
    meterMiles: { type: Number },
    waitMinutes: { type: Number },
    fareStrategy: {
      type: String,
      enum: ["meter", "flat"],
      default: "meter",
    },
    flatRateRef: { type: mongoose.Schema.Types.ObjectId, ref: "flatrates" },
    flatRateName: { type: String, trim: true },
    flatRateAmount: { type: Number },

    // Dispatch / assignment (via Active)
    status: {
      type: String,
      enum: ["Pending", "Assigned", "EnRoute", "PickedUp", "Completed", "Cancelled", "NoShow"],
      default: "Pending",
    },
    driverId: { type: String, trim: true },     // matches Active.driverId (String)
    cabNumber: { type: String, trim: true },    // matches Active.cabNumber (String)
    assignedAt: { type: Date },
    dispatchMethod: { type: String, enum: ["auto", "manual", "flagdown"], default: "manual" },
  tripSource: { type: String, enum: ["dispatch", "driver"], default: "dispatch" },

    flagdown: {
      createdByDriverId: { type: String, trim: true },
      createdAt: { type: Date },
      pickupDescription: { type: String },
    },

    driverLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: { type: [Number], default: undefined },
      updatedAt: { type: Date },
      speed: { type: Number },
      heading: { type: Number },
      accuracy: { type: Number },
    },

    driverLocationTrail: [
      {
        at: { type: Date, default: Date.now },
        point: {
          type: {
            type: String,
            enum: ["Point"],
            default: "Point",
          },
          coordinates: { type: [Number], default: undefined },
        },
        speed: { type: Number },
        heading: { type: Number },
        accuracy: { type: Number },
      },
    ],

    tripSession: {
      sessionId: { type: String, trim: true },
      clientSessionId: { type: String, trim: true },
      source: { type: String, enum: ["dispatch", "flagdown"], default: "dispatch" },
      deviceId: { type: String, trim: true },
      startedByDriverId: { type: String, trim: true },
      startedAt: { type: Date },
      localStartedAt: { type: Date },
      lastHeartbeatAt: { type: Date },
      lastEventAt: { type: Date },
      lastSyncAttemptAt: { type: Date },
      completedAt: { type: Date },
      cancelledAt: { type: Date },
      recoveryCount: { type: Number, default: 0, min: 0 },
      recoveredAt: { type: Date },
      eventCount: { type: Number, default: 0, min: 0 },
      duplicateEventCount: { type: Number, default: 0, min: 0 },
      queueDepth: { type: Number, default: 0, min: 0 },
      syncStatus: {
        type: String,
        enum: ["unknown", "online", "queued", "offline", "recovering", "completed", "cancelled"],
        default: "unknown",
      },
      nativeServiceRunning: { type: Boolean },
      appVersion: { type: String },
      androidVersion: { type: String },
      lastMeter: { type: mongoose.Schema.Types.Mixed },
      lastKnownLocalState: { type: mongoose.Schema.Types.Mixed },
    },

    syncIssues: {
      type: [
        {
          at: { type: Date, default: Date.now },
          level: { type: String, enum: ["info", "warn", "error"], default: "warn" },
          code: { type: String, trim: true },
          message: { type: String },
          queueDepth: { type: Number, min: 0 },
          payload: { type: mongoose.Schema.Types.Mixed },
        },
      ],
      default: [],
    },

    // Status timestamps
    confirmedAt: { type: Date },
    enRouteAt: { type: Date },
    pickedUpAt: { type: Date },
    droppedOffAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    noShowAt: { type: Date },

    // Cancellation / no-show detail
    cancelledBy: { type: String, enum: ["rider", "dispatcher", "admin"] },
    cancelReason: { type: String },
    noShowFeeApplied: { type: Boolean, default: false },

    // Flags/notes
    wheelchairNeeded: { type: Boolean, default: false },
    notes: { type: String },
    appliedFees: {
      type: [
        {
          name: { type: String, trim: true },
          amount: { type: Number, min: 0 },
        },
      ],
      default: [],
    },

    // System flags
    needs_reassignment: { type: Boolean, default: false },
    declinedDrivers: {
      type: [
        {
          driverId: { type: String, trim: true },
          declinedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    // Audit history (lightweight)
    history: [
      {
        at: { type: Date, default: Date.now },
        byUserId: { type: String },   // keep simple; align with your admin IDs as strings
        action: { type: String, required: true }, // 'create'|'update'|'assign'|'status'
        before: { type: mongoose.Schema.Types.Mixed },
        after: { type: mongoose.Schema.Types.Mixed },
        note: { type: String },
      },
    ],
  },
  { timestamps: true }
);

// ----- Indexes -----
BookingSchema.index({ pickupPoint: "2dsphere" });
BookingSchema.index({ dropoffPoint: "2dsphere" });
BookingSchema.index({ status: 1, pickupTime: 1 });
BookingSchema.index({ driverId: 1, pickupTime: 1, status: 1 });
BookingSchema.index({ cabNumber: 1, pickupTime: 1, status: 1 });
BookingSchema.index({ tripSource: 1, createdAt: -1 });
BookingSchema.index({ "tripSession.sessionId": 1 });
BookingSchema.index({ "tripSession.clientSessionId": 1 });
BookingSchema.index({ driverId: 1, status: 1, "tripSession.lastHeartbeatAt": -1 });

// ----- Helpers to sync lon/lat <-> GeoJSON -----
function setPointFromLonLat(doc, prefix) {
  const lon = doc[`${prefix}Lon`];
  const lat = doc[`${prefix}Lat`];
  if (typeof lon === "number" && typeof lat === "number") {
    doc[`${prefix}Point`] = { type: "Point", coordinates: [lon, lat] };
  } else {
    // Clear the entire field — a Point with no coordinates is invalid for the 2dsphere index
    doc[`${prefix}Point`] = undefined;
  }
}

// Generate unique random 5-digit bookingId before saving
BookingSchema.pre("save", async function (next) {
  if (!this.passengers || this.passengers < 1) this.passengers = 1;

  // Sync points
  setPointFromLonLat(this, "pickup");
  setPointFromLonLat(this, "dropoff");

  if (!this.bookingId) {
    this.bookingId = Math.floor(10000 + Math.random() * 90000);
  }
  next();
});

// Sync points on updates
async function syncPointsOnUpdate(next) {
  const update = this.getUpdate() || {};
  const $set = update.$set || update;

  const syncPrefixes = ["pickup", "dropoff"];
  for (const prefix of syncPrefixes) {
    const lonKey = `${prefix}Lon`;
    const latKey = `${prefix}Lat`;
    const pointKey = `${prefix}Point`;

    const lonProvided = Object.prototype.hasOwnProperty.call($set, lonKey);
    const latProvided = Object.prototype.hasOwnProperty.call($set, latKey);

    if (lonProvided || latProvided) {
      const lon = $set[lonKey];
      const lat = $set[latKey];
      if (typeof lon === "number" && typeof lat === "number") {
        $set[pointKey] = { type: "Point", coordinates: [lon, lat] };
      } else {
        if (!update.$unset) update.$unset = {};
        update.$unset[pointKey] = 1;
      }
    }
  }

  // Prevent bookingId changes
  if ($set && Object.prototype.hasOwnProperty.call($set, "bookingId")) {
    delete $set.bookingId;
  }

  next();
}

BookingSchema.pre("findOneAndUpdate", syncPointsOnUpdate);
BookingSchema.pre("updateOne", syncPointsOnUpdate);
BookingSchema.pre("updateMany", syncPointsOnUpdate);

const BookingModel = mongoose.model("bookings", BookingSchema);
export default BookingModel;
