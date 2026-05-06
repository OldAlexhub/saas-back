import mongoose from "mongoose";

// Positive field selection for driver-facing queries — never exposes agency fare or billing.
export const NEMT_DRIVER_TRIP_SELECT =
  "tripId agencyTripRef serviceDate passengerName passengerPhone mobilityType " +
  "passengerCount attendantCount specialInstructions " +
  "pickupAddress pickupLon pickupLat pickupPoint scheduledPickupTime pickupWindowEarliest pickupWindowLatest " +
  "dropoffAddress dropoffLon dropoffLat dropoffPoint appointmentTime tripDirection " +
  "status runId runSequence driverId cabNumber " +
  "enRouteAt arrivedPickupAt pickedUpAt arrivedDropAt completedAt cancelledAt noShowAt " +
  "cancelReason noShowReason " +
  "driverPay payStatus paidAt payReference payHoldReason payDisputeReason " +
  "otpStatus createdAt updatedAt";

function setNemtPoint(doc, prefix) {
  const lon = doc[`${prefix}Lon`];
  const lat = doc[`${prefix}Lat`];
  const usable =
    typeof lon === "number" &&
    typeof lat === "number" &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180 &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001);
  if (usable) {
    doc[`${prefix}Point`] = { type: "Point", coordinates: [lon, lat] };
  } else {
    doc[`${prefix}Point`] = undefined;
  }
}

const NemtTripSchema = new mongoose.Schema(
  {
    tripId: { type: Number, unique: true },

    // Agency
    agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "nemtagencies", required: true },
    agencyTripRef: { type: String, trim: true },
    importBatchId: { type: String, trim: true },

    // Service date (midnight UTC for the service day, used for grouping and filtering)
    serviceDate: { type: Date, required: true },

    // Passenger
    passengerName: { type: String, required: true, trim: true },
    passengerPhone: { type: String, trim: true, default: "" },
    passengerId: { type: String, trim: true },
    passengerDob: { type: Date },
    mobilityType: {
      type: String,
      enum: ["ambulatory", "wheelchair", "wheelchair_xl", "stretcher", "other"],
      default: "ambulatory",
    },
    passengerCount: { type: Number, default: 1, min: 1 },
    attendantCount: { type: Number, default: 0, min: 0 },

    specialInstructions: { type: String, trim: true, default: "" },
    internalNotes: { type: String, trim: true, default: "" },

    // Pickup
    pickupAddress: { type: String, required: true, trim: true },
    pickupLon: { type: Number },
    pickupLat: { type: Number },
    pickupPoint: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: undefined },
    },
    scheduledPickupTime: { type: Date, required: true },
    pickupWindowEarliest: { type: Date },
    pickupWindowLatest: { type: Date },

    // Dropoff
    dropoffAddress: { type: String, required: true, trim: true },
    dropoffLon: { type: Number },
    dropoffLat: { type: Number },
    dropoffPoint: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: undefined },
    },
    appointmentTime: { type: Date },

    // Trip direction and linking
    tripDirection: { type: String, enum: ["outbound", "return"], default: "outbound" },
    linkedTripId: { type: mongoose.Schema.Types.ObjectId, ref: "nemttrips" },

    // Status
    status: {
      type: String,
      enum: [
        "Scheduled",
        "Assigned",
        "Dispatched",
        "EnRoute",
        "ArrivedPickup",
        "PickedUp",
        "ArrivedDrop",
        "Completed",
        "Cancelled",
        "NoShow",
        "PassengerCancelled",
      ],
      default: "Scheduled",
    },

    // Run assignment
    runId: { type: mongoose.Schema.Types.ObjectId, ref: "nemtruns" },
    runSequence: { type: Number },
    assignedAt: { type: Date },
    dispatchedAt: { type: Date },

    // Denormalized from run for efficient per-driver queries
    driverId: { type: String, trim: true },
    cabNumber: { type: String, trim: true },

    // Status timestamps
    enRouteAt: { type: Date },
    arrivedPickupAt: { type: Date },
    pickedUpAt: { type: Date },
    arrivedDropAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    noShowAt: { type: Date },

    // Cancel / no-show detail
    cancelledBy: { type: String, enum: ["dispatch", "passenger", "agency"] },
    cancelReason: { type: String },
    noShowReason: { type: String },

    // ---- ADMIN-ONLY FIELDS ----
    // These are never included in driver API responses. Defense in depth:
    // (1) toDriverNemtTripPayload excludes them, (2) driver queries use NEMT_DRIVER_TRIP_SELECT.

    // Agency fare
    agencyFare: { type: Number },
    agencyFareBasis: { type: String, enum: ["per_trip", "per_mile", "flat"] },
    estimatedMiles: { type: Number, min: 0 },
    actualMiles: { type: Number, min: 0 },

    // Agency billing status
    billingStatus: {
      type: String,
      enum: ["unbilled", "billed", "paid", "disputed", "void"],
      default: "unbilled",
    },
    billingBatchId: { type: mongoose.Schema.Types.ObjectId, ref: "nemtpaymentbatches" },
    billedAt: { type: Date },
    billingPaidAt: { type: Date },
    billingReference: { type: String, trim: true },

    // ---- DRIVER-VISIBLE PAY FIELDS ----
    // Only the net driver pay amount — no gross fare, no company cut.

    driverPay: { type: Number },
    driverPayBasis: { type: String, enum: ["per_trip", "per_mile", "flat"] },
    payStatus: {
      type: String,
      enum: ["unpaid", "paid", "held", "disputed"],
      default: "unpaid",
    },
    payBatchId: { type: mongoose.Schema.Types.ObjectId, ref: "nemtpaymentbatches" },
    paidAt: { type: Date },
    payReference: { type: String, trim: true },
    payHoldReason: { type: String, trim: true },
    payDisputeReason: { type: String, trim: true },

    // OTP
    otpStatus: {
      type: String,
      enum: ["on_time", "early", "late", "no_data"],
      default: "no_data",
    },
    scheduledVsActualMinutes: { type: Number },

    // Audit history
    history: [
      {
        at: { type: Date, default: Date.now },
        byUserId: { type: String },
        action: { type: String, required: true },
        before: { type: mongoose.Schema.Types.Mixed },
        after: { type: mongoose.Schema.Types.Mixed },
        note: { type: String },
      },
    ],
  },
  { timestamps: true }
);

// ----- Indexes -----
NemtTripSchema.index({ pickupPoint: "2dsphere" });
NemtTripSchema.index({ dropoffPoint: "2dsphere" });
NemtTripSchema.index({ serviceDate: 1, status: 1 });
NemtTripSchema.index({ agencyId: 1, serviceDate: 1 });
NemtTripSchema.index({ runId: 1, runSequence: 1 });
NemtTripSchema.index({ driverId: 1, serviceDate: 1, status: 1 });
NemtTripSchema.index({ billingStatus: 1, status: 1 });
NemtTripSchema.index({ payStatus: 1, driverId: 1 });
NemtTripSchema.index({ importBatchId: 1 });
NemtTripSchema.index({ scheduledPickupTime: 1 });

// ----- Pre-save: auto-assign tripId and sync GeoJSON points -----
NemtTripSchema.pre("save", function (next) {
  if (!this.tripId) {
    this.tripId = Math.floor(10000 + Math.random() * 90000);
  }
  setNemtPoint(this, "pickup");
  setNemtPoint(this, "dropoff");
  next();
});

// Sync GeoJSON points on findOneAndUpdate / updateOne / updateMany
async function syncNemtPointsOnUpdate(next) {
  const update = this.getUpdate() || {};
  const $set = update.$set || update;
  for (const prefix of ["pickup", "dropoff"]) {
    const lonKey = `${prefix}Lon`;
    const latKey = `${prefix}Lat`;
    const pointKey = `${prefix}Point`;
    const lonProvided = Object.prototype.hasOwnProperty.call($set, lonKey);
    const latProvided = Object.prototype.hasOwnProperty.call($set, latKey);
    if (lonProvided || latProvided) {
      const lon = $set[lonKey];
      const lat = $set[latKey];
      const usable =
        typeof lon === "number" && typeof lat === "number" &&
        lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
        !(Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001);
      if (usable) {
        $set[pointKey] = { type: "Point", coordinates: [lon, lat] };
      } else {
        if (!update.$unset) update.$unset = {};
        update.$unset[pointKey] = 1;
      }
    }
  }
  if ($set && Object.prototype.hasOwnProperty.call($set, "tripId")) {
    delete $set.tripId;
  }
  next();
}

NemtTripSchema.pre("findOneAndUpdate", syncNemtPointsOnUpdate);
NemtTripSchema.pre("updateOne", syncNemtPointsOnUpdate);
NemtTripSchema.pre("updateMany", syncNemtPointsOnUpdate);

const NemtTripModel = mongoose.model("nemttrips", NemtTripSchema);
export default NemtTripModel;
