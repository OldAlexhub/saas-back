import config from "../config/index.js";
import ActiveModel from "../models/ActiveSchema.js";
import BookingModel from "../models/BookingSchema.js";
import DriverHOSModel from "../models/DriverHOS.js";
import DriverLocationTimelineModel from "../models/DriverLocationTimeline.js";
import DriverModel from "../models/DriverSchema.js";
import { SINGLETON_ID as FARE_SINGLETON_ID, FareModel } from "../models/FareSchema.js";
import FlatRateModel from "../models/FlatRateSchema.js";
import { emitToAdmins, emitToDriver } from "../realtime/index.js";
import { toAdminBookingPayload, toDriverBookingPayload } from "../realtime/payloads.js";
import { diffChanges } from "../utils/diff.js";

const DRIVER_VISIBLE_BOOKING_FIELDS = [
  "bookingId",
  "customerName",
  "phoneNumber",
  "pickupAddress",
  "pickupTime",
  "dropoffAddress",
  "pickupLat",
  "pickupLon",
  "dropoffLat",
  "dropoffLon",
  "pickupPoint",
  "dropoffPoint",
  "passengers",
  "notes",
  "status",
  "driverId",
  "cabNumber",
  "dispatchMethod",
  "assignedAt",
  "confirmedAt",
  "enRouteAt",
  "pickedUpAt",
  "droppedOffAt",
  "completedAt",
  "cancelledAt",
  "noShowAt",
  "cancelledBy",
  "cancelReason",
  "estimatedFare",
  "finalFare",
  "meterMiles",
  "waitMinutes",
  "tripSource",
  "flagdown",
  "driverLocation",
  "driverLocationTrail",
];

const DRIVER_LOCATION_TRAIL_MAX = 50;
const DRIVER_LOCATION_TRAIL_RESPONSE_MAX = 10;

const DRIVER_ALLOWED_STATUS_TRANSITIONS = {
  Assigned: ["EnRoute", "NoShow", "Cancelled"],
  EnRoute: ["PickedUp", "NoShow", "Cancelled"],
  PickedUp: ["Completed", "Cancelled"],
};

function sanitizeDriver(driver) {
  if (!driver) return null;
  const plain = typeof driver.toObject === "function" ? driver.toObject() : { ...driver };
  delete plain.ssn;
  delete plain.history;
  if (plain.driverApp) {
    const { forcePasswordReset = false, lastLoginAt, lastLogoutAt, deviceId, pushToken } =
      plain.driverApp;
    plain.driverApp = {
      forcePasswordReset: Boolean(forcePasswordReset),
      lastLoginAt: lastLoginAt || null,
      lastLogoutAt: lastLogoutAt || null,
      deviceId: deviceId || null,
      pushToken: pushToken || null,
    };
  }
  return plain;
}

function sanitizeBooking(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete plain.history;
  delete plain.__v;
  if (Array.isArray(plain.driverLocationTrail) && plain.driverLocationTrail.length > 0) {
    plain.driverLocationTrail = plain.driverLocationTrail.slice(-DRIVER_LOCATION_TRAIL_RESPONSE_MAX);
  }
  return plain;
}

function sanitizeActive(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete plain.history;
  delete plain.__v;
  return plain;
}

function toGeoPoint({ lat, lng, currentLocation }) {
  if (currentLocation && Array.isArray(currentLocation.coordinates)) {
    const [lon, la] = currentLocation.coordinates.map(Number);
    if (Number.isFinite(lon) && Number.isFinite(la)) {
      return { type: "Point", coordinates: [lon, la], updatedAt: new Date() };
    }
  }

  if (lat !== undefined && lng !== undefined) {
    const la = Number(lat);
    const lon = Number(lng);
    if (Number.isFinite(la) && Number.isFinite(lon)) {
      return { type: "Point", coordinates: [lon, la], updatedAt: new Date() };
    }
  }

  return null;
}

function coerceNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function buildDriverLocationUpdate({ lat, lng, speed, heading, accuracy }) {
  const la = Number(lat);
  const lon = Number(lng);

  if (!Number.isFinite(la) || !Number.isFinite(lon)) {
    return null;
  }

  const at = new Date();
  const point = { type: "Point", coordinates: [lon, la] };

  const meta = {
    at,
    point,
    speed: coerceNumber(speed),
    heading: coerceNumber(heading),
    accuracy: coerceNumber(accuracy),
  };

  return {
    location: { ...point, updatedAt: at, speed: meta.speed, heading: meta.heading, accuracy: meta.accuracy },
    trailEntry: meta,
  };
}

function applyDropoffData(booking, { dropoffAddress, dropoffLat, dropoffLon }) {
  if (dropoffAddress !== undefined) {
    booking.dropoffAddress = dropoffAddress ? String(dropoffAddress).trim() : undefined;
  }

  const lat = coerceNumber(dropoffLat);
  const lon = coerceNumber(dropoffLon);

  if (lat !== undefined && lon !== undefined) {
    booking.dropoffLat = lat;
    booking.dropoffLon = lon;
    booking.dropoffPoint = { type: "Point", coordinates: [lon, lat] };
  }
}

function roundFareAmount(value, mode = "none") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  let rounded;
  switch (mode) {
    case "nearest_0.1":
      rounded = Math.round(amount * 10) / 10;
      break;
    case "nearest_0.25":
      rounded = Math.round(amount * 4) / 4;
      break;
    case "nearest_0.5":
      rounded = Math.round(amount * 2) / 2;
      break;
    case "nearest_1":
      rounded = Math.round(amount);
      break;
    case "none":
    default:
      rounded = Math.round(amount * 100) / 100;
      break;
  }
  return Number(rounded.toFixed(2));
}

function computeMeterSubtotal({ fareConfig, meterMiles, waitMinutes, passengerCount }) {
  const miles = Number(meterMiles ?? 0);
  if (!Number.isFinite(miles) || miles < 0) {
    throw new Error("meterMiles must be a non-negative number.");
  }
  const wait = Number(waitMinutes ?? 0);
  if (!Number.isFinite(wait) || wait < 0) {
    throw new Error("waitMinutes must be a non-negative number.");
  }

  let total = 0;
  total += Number(fareConfig.baseFare ?? 0);
  total += miles * Number(fareConfig.farePerMile ?? 0);
  total += wait * Number(fareConfig.waitTimePerMinute ?? 0);

  const passengers = Number(passengerCount ?? 1);
  if (passengers > 1 && fareConfig.extraPass) {
    total += (passengers - 1) * Number(fareConfig.extraPass ?? 0);
  }

  if (fareConfig.surgeEnabled && fareConfig.surgeMultiplier) {
    total *= Number(fareConfig.surgeMultiplier ?? 1);
  }

  if (fareConfig.minimumFare && total < fareConfig.minimumFare) {
    total = Number(fareConfig.minimumFare);
  }

  return {
    subtotal: total,
    meterMiles: miles,
    waitMinutes: wait,
  };
}

function resolveOtherFeesByName(names, configuredFees = []) {
  if (!Array.isArray(names) || names.length === 0) {
    return { fees: [], total: 0 };
  }

  const lookup = new Map();
  configuredFees.forEach((fee) => {
    if (!fee || !fee.name) return;
    lookup.set(String(fee.name).trim().toLowerCase(), fee);
  });

  const applied = [];
  let total = 0;
  const seen = new Set();

  for (const rawName of names) {
    const normalized = String(rawName ?? "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    const configFee = lookup.get(key);
    if (!configFee) {
      throw new Error(`Unknown other fee "${normalized}".`);
    }
    const amount = Number(configFee.amount ?? 0);
    applied.push({ name: configFee.name, amount });
    total += amount;
    seen.add(key);
  }

  return { fees: applied, total };
}

function stampStatusTime(booking, toStatus) {
  const now = new Date();
  switch (toStatus) {
    case "Assigned":
      booking.assignedAt = booking.assignedAt || now;
      booking.confirmedAt = booking.confirmedAt || now;
      break;
    case "EnRoute":
      booking.enRouteAt = now;
      break;
    case "PickedUp":
      booking.pickedUpAt = now;
      break;
    case "Completed":
      booking.droppedOffAt = booking.droppedOffAt || now;
      booking.completedAt = now;
      break;
    case "Cancelled":
      booking.cancelledAt = now;
      break;
    case "NoShow":
      booking.noShowAt = now;
      break;
  }
}

function isTransitionAllowed(from, to) {
  if (!from || !to) return false;
  if (from === to) return false;
  const allowed = DRIVER_ALLOWED_STATUS_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export const getDriverProfile = async (req, res) => {
  try {
    const driver = await DriverModel.findById(req.driver.id).select("-ssn -history");
    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }

    const active = await ActiveModel.findOne({ driverId: driver.driverId }).select("-history");
    const upcoming = await BookingModel.find({
      driverId: driver.driverId,
      status: { $in: ["Assigned", "EnRoute", "PickedUp"] },
    })
      .select(DRIVER_VISIBLE_BOOKING_FIELDS.join(" "))
      .sort({ pickupTime: 1 })
      .limit(5)
      .lean();

    return res.status(200).json({
      driver: sanitizeDriver(driver),
      active: sanitizeActive(active),
      upcomingBookings: upcoming.map(sanitizeBooking),
    });
  } catch (error) {
    console.error("Driver profile error:", error);
    return res.status(500).json({ message: "Server error while fetching profile." });
  }
};

export const getDriverFare = async (_req, res) => {
  try {
    const fare = await FareModel.findById(FARE_SINGLETON_ID).lean();
    const flatRates = await FlatRateModel.find({ active: true }).sort({ amount: 1, name: 1 }).lean();

    if (!fare) {
      return res.status(404).json({ message: "Fare structure not configured." });
    }

    return res.status(200).json({
      fare,
      flatRates,
    });
  } catch (error) {
    console.error("Driver fare fetch error:", error);
    return res.status(500).json({ message: "Server error while fetching fare configuration." });
  }
};

export const listMyBookings = async (req, res) => {
  try {
    const { status, from, to } = req.query || {};
    const statuses = Array.isArray(status)
      ? status
      : typeof status === "string" && status.length
      ? status.split(",").map((s) => s.trim()).filter(Boolean)
      : ["Assigned", "EnRoute", "PickedUp"];

    const query = {
      driverId: req.driver.driverId,
    };

    if (statuses.length) {
      query.status = { $in: statuses };
    }

    if (from || to) {
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;
      if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
        return res.status(400).json({ message: "from/to must be valid ISO dates." });
      }
      query.pickupTime = {};
      if (fromDate) query.pickupTime.$gte = fromDate;
      if (toDate) query.pickupTime.$lte = toDate;
    }

    const bookings = await BookingModel.find(query)
      .select(DRIVER_VISIBLE_BOOKING_FIELDS.join(" "))
      .sort({ pickupTime: 1 })
      .lean();

    return res.status(200).json({ count: bookings.length, bookings: bookings.map(sanitizeBooking) });
  } catch (error) {
    console.error("Driver bookings error:", error);
    return res.status(500).json({ message: "Server error while fetching bookings." });
  }
};

export const getCurrentAssignment = async (req, res) => {
  try {
    const booking = await BookingModel.findOne({
      driverId: req.driver.driverId,
      status: { $in: ["Assigned", "EnRoute", "PickedUp"] },
    })
      .select(DRIVER_VISIBLE_BOOKING_FIELDS.join(" "))
      .sort({ pickupTime: 1, createdAt: 1 })
      .lean();

    if (!booking) {
      return res.status(200).json({ booking: null });
    }

    return res.status(200).json({ booking: sanitizeBooking(booking) });
  } catch (error) {
    console.error("Driver current assignment error:", error);
    return res.status(500).json({ message: "Server error while fetching current assignment." });
  }
};

export const acknowledgeMyBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body || {};

    const booking = await BookingModel.findOne({ _id: id, driverId: req.driver.driverId });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found for driver." });
    }

    if (booking.dispatchMethod === "flagdown" || booking.tripSource === "driver") {
      return res.status(400).json({ message: "Flagdown trips do not require acknowledgement." });
    }

    if (booking.status !== "Assigned") {
      return res.status(400).json({ message: "Only Assigned trips can be acknowledged." });
    }

    const beforeStatus = booking.status;
    booking.status = "EnRoute";
    stampStatusTime(booking, "EnRoute");

    if (!Array.isArray(booking.history)) booking.history = [];
    booking.history.push({
      at: new Date(),
      byUserId: req.driver.driverId,
      action: "status",
      before: { status: beforeStatus },
      after: { status: "EnRoute" },
      note: note || "Driver acknowledged dispatch",
    });

    await booking.save();

    const driverPayload = toDriverBookingPayload(booking);
    if (driverPayload?.driverId) {
      emitToDriver(driverPayload.driverId, "booking:status", {
        event: "acknowledged",
        booking: driverPayload,
      });
    }
    emitToAdmins("assignment:updated", {
      event: "acknowledged",
      booking: toAdminBookingPayload(booking),
    });

    return res
      .status(200)
      .json({ message: "Booking acknowledged.", booking: sanitizeBooking(booking) });
  } catch (error) {
    console.error("Driver acknowledge error:", error);
    return res.status(500).json({ message: "Server error while acknowledging booking." });
  }
};

export const declineMyBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const driverId = req.driver.driverId;

    const booking = await BookingModel.findOne({ _id: id, driverId });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found for driver." });
    }

    if (booking.status !== "Assigned") {
      return res.status(400).json({ message: "Only Assigned trips can be declined." });
    }

    // Ensure arrays exist
    if (!Array.isArray(booking.declinedDrivers)) booking.declinedDrivers = [];
    if (!Array.isArray(booking.history)) booking.history = [];

    // Avoid duplicate decline entries for the same driver
    const alreadyDeclined = booking.declinedDrivers.some(d => d.driverId === driverId);
    if (!alreadyDeclined) {
      booking.declinedDrivers.push({ driverId, declinedAt: new Date() });
    }

    const before = {
      status: booking.status,
      driverId: booking.driverId,
      cabNumber: booking.cabNumber,
    };

    // Reset assignment and mark for reassignment
    booking.driverId = null;
    booking.cabNumber = null;
    booking.status = "Pending";
    booking.needs_reassignment = true;

    booking.history.push({
      at: new Date(),
      byUserId: driverId,
      action: "status",
      before,
      after: { status: "Pending", driverId: null, cabNumber: null },
      note: "Driver declined assignment",
    });

    await booking.save();

    emitToDriver(driverId, "assignment:cancelled", {
      id: booking._id.toString(),
      bookingId: booking.bookingId,
    });
    emitToAdmins("assignment:updated", {
      event: "declined",
      booking: toAdminBookingPayload(booking),
    });

    return res
      .status(200)
      .json({ message: "Booking declined.", booking: sanitizeBooking(booking) });
  } catch (error) {
    console.error("Driver decline error:", error);
    return res.status(500).json({ message: "Server error while declining booking." });
  }
};


export const reportBookingLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const { lat, lng, speed, heading, accuracy } = req.body || {};

    const booking = await BookingModel.findOne({
      _id: id,
      driverId: req.driver.driverId,
      status: { $in: ["Assigned", "EnRoute", "PickedUp"] },
    });

    if (!booking) {
      return res.status(404).json({ message: "Active booking not found for driver." });
    }

    const update = buildDriverLocationUpdate({ lat, lng, speed, heading, accuracy });
    if (!update) {
      return res.status(400).json({ message: "lat and lng are required and must be numbers." });
    }

    try {
      await DriverLocationTimelineModel.create({
        driverId: req.driver.driverId,
        bookingId: booking._id,
        tripSource: booking.tripSource || "dispatch",
        point: {
          type: "Point",
          coordinates: update.location.coordinates,
        },
        speed: update.location.speed,
        heading: update.location.heading,
        accuracy: update.location.accuracy,
        capturedAt: update.location.updatedAt || new Date(),
      });
    } catch (timelineError) {
      console.warn("timeline insert error:", timelineError.message);
    }

    booking.driverLocation = update.location;
    if (!Array.isArray(booking.driverLocationTrail)) {
      booking.driverLocationTrail = [];
    }
    booking.driverLocationTrail.push(update.trailEntry);
    if (booking.driverLocationTrail.length > DRIVER_LOCATION_TRAIL_MAX) {
      booking.driverLocationTrail = booking.driverLocationTrail.slice(-DRIVER_LOCATION_TRAIL_MAX);
    }

    booking.history.push({
      at: new Date(),
      byUserId: req.driver.driverId,
      action: "location",
      after: { driverLocation: update.location },
      note: "Driver location update",
    });

    await booking.save();

    emitToAdmins("driver:location", {
      booking: toAdminBookingPayload(booking),
      driverLocation: booking.driverLocation,
    });

    return res.status(200).json({ message: "Location recorded.", booking: sanitizeBooking(booking) });
  } catch (error) {
    console.error("Driver trip location error:", error);
    return res.status(500).json({ message: "Server error while recording location." });
  }
};

export const createFlagdownRide = async (req, res) => {
  try {
    const active = await ActiveModel.findOne({ driverId: req.driver.driverId });
    if (!active || active.status !== "Active") {
      return res.status(409).json({ message: "Driver must be Active on the roster to record a flagdown." });
    }

    if (active.availability !== "Online") {
      return res.status(409).json({ message: "Driver must be marked Online before starting a flagdown ride." });
    }

    if (!active.cabNumber) {
      return res.status(409).json({ message: "Active roster record is missing a cab assignment." });
    }

    const {
      customerName,
      phoneNumber,
      pickupAddress,
      pickupDescription,
      pickupLat,
      pickupLon,
      dropoffAddress,
      dropoffLat,
      dropoffLon,
      passengers,
      notes,
      estimatedFare,
    } = req.body || {};

    const passengersNum = coerceNumber(passengers);
    if (passengers !== undefined && (passengersNum === undefined || passengersNum < 1)) {
      return res.status(400).json({ message: "passengers must be a positive number." });
    }

    const pickupLatNum = coerceNumber(pickupLat);
    const pickupLonNum = coerceNumber(pickupLon);
    if (
      (pickupLat !== undefined || pickupLon !== undefined) &&
      (pickupLatNum === undefined || pickupLonNum === undefined)
    ) {
      return res.status(400).json({ message: "pickupLat and pickupLon must both be valid numbers." });
    }

    const dropoffLatNum = coerceNumber(dropoffLat);
    const dropoffLonNum = coerceNumber(dropoffLon);
    if (
      (dropoffLat !== undefined || dropoffLon !== undefined) &&
      (dropoffLatNum === undefined || dropoffLonNum === undefined)
    ) {
      return res.status(400).json({ message: "dropoffLat and dropoffLon must both be valid numbers." });
    }

    const estimatedFareNum = coerceNumber(estimatedFare);
    if (estimatedFare !== undefined && estimatedFareNum === undefined) {
      return res.status(400).json({ message: "estimatedFare must be a number." });
    }

    const now = new Date();
    const booking = new BookingModel({
      customerName: customerName ? String(customerName).trim() : "Flagdown Rider",
      phoneNumber: phoneNumber ? String(phoneNumber).trim() : "FLAGDOWN",
      pickupAddress: pickupAddress ? String(pickupAddress).trim() : "Flagdown Pickup",
      pickupTime: now,
      dropoffAddress: dropoffAddress ? String(dropoffAddress).trim() : undefined,
      pickupLat: pickupLatNum,
      pickupLon: pickupLonNum,
      dropoffLat: dropoffLatNum,
      dropoffLon: dropoffLonNum,
      passengers: passengersNum ? Math.max(1, Math.round(passengersNum)) : 1,
      notes: notes ? String(notes).trim() : undefined,
      estimatedFare: estimatedFareNum,
      status: "PickedUp",
      driverId: req.driver.driverId,
      cabNumber: active.cabNumber,
      dispatchMethod: "flagdown",
      tripSource: "driver",
      assignedAt: now,
      confirmedAt: now,
      pickedUpAt: now,
      flagdown: {
        createdByDriverId: req.driver.driverId,
        createdAt: now,
        pickupDescription: pickupDescription ? String(pickupDescription).trim() : undefined,
      },
    });

    applyDropoffData(booking, { dropoffAddress, dropoffLat: dropoffLatNum, dropoffLon: dropoffLonNum });

    booking.history.push({
      at: now,
      byUserId: req.driver.driverId,
      action: "create",
      after: {
        status: "PickedUp",
        dispatchMethod: booking.dispatchMethod,
        tripSource: booking.tripSource,
        driverId: booking.driverId,
        cabNumber: booking.cabNumber,
      },
      note: "Driver recorded flagdown ride",
    });

    await booking.save();

    const driverPayload = toDriverBookingPayload(booking);
    if (driverPayload?.driverId) {
      emitToDriver(driverPayload.driverId, "booking:status", {
        event: "flagdown",
        booking: driverPayload,
      });
    }
    emitToAdmins("assignment:updated", {
      event: "flagdown",
      booking: toAdminBookingPayload(booking),
    });

    return res.status(201).json({ message: "Flagdown ride captured.", booking: sanitizeBooking(booking) });
  } catch (error) {
    console.error("Driver flagdown error:", error);
    return res.status(500).json({ message: "Server error while recording flagdown ride." });
  }
};

export const updateMyBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status: nextStatus,
      note,
      finalFare,
      meterMiles,
      waitMinutes,
      dropoffAddress,
      dropoffLat,
      dropoffLon,
      cancelReason,
      cancelledBy,
      noShowFeeApplied,
      flatRateId,
      otherFeeNames = [],
    } = req.body || {};

    if (!nextStatus) {
      return res.status(400).json({ message: "Next status is required." });
    }

    if (finalFare !== undefined) {
      return res
        .status(400)
        .json({ message: "finalFare is calculated automatically and cannot be overridden." });
    }

    const booking = await BookingModel.findOne({ _id: id, driverId: req.driver.driverId });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found for driver." });
    }

    if (!isTransitionAllowed(booking.status, nextStatus)) {
      return res
        .status(400)
        .json({ message: `Status change from ${booking.status} to ${nextStatus} is not allowed.` });
    }

    if (nextStatus === "Cancelled" && !cancelReason) {
      return res.status(400).json({ message: "cancelReason is required when cancelling a trip." });
    }

    const meterMilesNum = coerceNumber(meterMiles);
    if (meterMiles !== undefined && meterMilesNum === undefined) {
      return res.status(400).json({ message: "meterMiles must be a number." });
    }

    const waitMinutesNum = coerceNumber(waitMinutes);
    if (waitMinutes !== undefined && waitMinutesNum === undefined) {
      return res.status(400).json({ message: "waitMinutes must be a number." });
    }

    const previousStatus = booking.status;
    booking.status = nextStatus;

    if (nextStatus === "Cancelled") {
      booking.cancelledBy = cancelledBy || "driver";
      booking.cancelReason = cancelReason;
    }

    if (nextStatus === "NoShow" && typeof noShowFeeApplied === "boolean") {
      booking.noShowFeeApplied = noShowFeeApplied;
    }

    if (nextStatus === "Completed") {
      const dropLatNum = coerceNumber(dropoffLat);
      const dropLonNum = coerceNumber(dropoffLon);
      if (
        (dropoffLat !== undefined || dropoffLon !== undefined) &&
        (dropLatNum === undefined || dropLonNum === undefined)
      ) {
        return res
          .status(400)
          .json({ message: "dropoffLat and dropoffLon must both be valid numbers when supplied." });
      }

      const fareConfig = await FareModel.findById(FARE_SINGLETON_ID).lean();
      if (!fareConfig) {
        return res.status(500).json({ message: "Fare configuration is missing. Contact dispatch." });
      }

      const normalizedFeeNames = Array.isArray(otherFeeNames)
        ? otherFeeNames
            .map((name) => String(name || "").trim())
            .filter((name) => name.length > 0)
        : [];

      let otherFeesResult;
      try {
        otherFeesResult = resolveOtherFeesByName(normalizedFeeNames, fareConfig.otherFees || []);
      } catch (feeError) {
        return res.status(400).json({ message: feeError.message });
      }

      let totalFare = 0;

      if (flatRateId) {
        const flatRate = await FlatRateModel.findOne({ _id: flatRateId, active: true });
        if (!flatRate) {
          return res.status(404).json({ message: "Selected flat rate is no longer active." });
        }
        booking.fareStrategy = "flat";
        booking.flatRateRef = flatRate._id;
        booking.flatRateName = flatRate.name;
        booking.flatRateAmount = flatRate.amount;
        totalFare = Number(flatRate.amount ?? 0);
        if (meterMilesNum !== undefined) booking.meterMiles = meterMilesNum;
        if (waitMinutesNum !== undefined) booking.waitMinutes = waitMinutesNum;
      } else {
        if (meterMilesNum === undefined) {
          return res
            .status(400)
            .json({ message: "meterMiles is required to complete the trip without a flat rate." });
        }
        const meterResult = computeMeterSubtotal({
          fareConfig,
          meterMiles: meterMilesNum,
          waitMinutes: waitMinutesNum ?? booking.waitMinutes ?? 0,
          passengerCount: booking.passengers,
        });
        booking.fareStrategy = "meter";
        booking.set("flatRateRef", undefined);
        booking.set("flatRateName", undefined);
        booking.set("flatRateAmount", undefined);
        booking.meterMiles = meterResult.meterMiles;
        booking.waitMinutes = meterResult.waitMinutes;
        totalFare = meterResult.subtotal;
      }

      totalFare += otherFeesResult.total;
      totalFare = roundFareAmount(totalFare, fareConfig.meterRoundingMode || "none");
      booking.finalFare = totalFare;
      booking.appliedFees = otherFeesResult.fees;

      applyDropoffData(booking, { dropoffAddress, dropoffLat: dropLatNum, dropoffLon: dropLonNum });
    }

    stampStatusTime(booking, nextStatus);

    const historyAfter = {
      status: nextStatus,
    };

    if (nextStatus === "Cancelled") {
      historyAfter.cancelledBy = booking.cancelledBy;
      historyAfter.cancelReason = booking.cancelReason;
    }

    if (nextStatus === "NoShow") {
      historyAfter.noShowFeeApplied = booking.noShowFeeApplied;
    }

    if (nextStatus === "Completed") {
      historyAfter.finalFare = booking.finalFare;
      historyAfter.meterMiles = booking.meterMiles;
      historyAfter.waitMinutes = booking.waitMinutes;
      historyAfter.droppedOffAt = booking.droppedOffAt;
      historyAfter.dropoffAddress = booking.dropoffAddress;
      historyAfter.dropoffLat = booking.dropoffLat;
      historyAfter.dropoffLon = booking.dropoffLon;
      historyAfter.fareStrategy = booking.fareStrategy;
      if (booking.fareStrategy === "flat") {
        historyAfter.flatRateName = booking.flatRateName;
        historyAfter.flatRateAmount = booking.flatRateAmount;
      }
      if (Array.isArray(booking.appliedFees) && booking.appliedFees.length > 0) {
        historyAfter.appliedFees = booking.appliedFees;
      }
    }

    booking.history.push({
      at: new Date(),
      byUserId: req.driver.driverId,
      action: "status",
      before: { status: previousStatus },
      after: historyAfter,
      note: note || `Driver set status to ${nextStatus}`,
    });

    await booking.save();

    const driverPayload = toDriverBookingPayload(booking);
    if (driverPayload?.driverId) {
      emitToDriver(driverPayload.driverId, "booking:status", {
        event: "status",
        previousStatus,
        booking: driverPayload,
      });
    }
    emitToAdmins("assignment:updated", {
      event: "status",
      previousStatus,
      booking: toAdminBookingPayload(booking),
    });

    return res.status(200).json({ message: "Status updated.", booking: sanitizeBooking(booking) });
  } catch (error) {
    console.error("Driver status update error:", error);
    return res.status(500).json({ message: "Server error while updating booking status." });
  }
};

export const registerDriverPushToken = async (req, res) => {
  try {
    const { pushToken, deviceId } = req.body || {};
    if (!pushToken || typeof pushToken !== "string") {
      return res.status(400).json({ message: "pushToken is required." });
    }

    const driver = await DriverModel.findById(req.driver.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }

    if (!driver.driverApp) driver.driverApp = {};
    driver.driverApp.pushToken = String(pushToken).trim();
    if (deviceId !== undefined) {
      driver.driverApp.deviceId = deviceId ? String(deviceId).trim() : undefined;
    }
    await driver.save();

    return res.status(200).json({ message: "Push token registered.", driver: sanitizeDriver(driver) });
  } catch (error) {
    console.error("Driver push token registration error:", error);
    return res.status(500).json({ message: "Server error while registering push token." });
  }
};

export const updatePresence = async (req, res) => {
  try {
    const { availability, status, lat, lng, currentLocation, hoursOfService, note } = req.body || {};

    const active = await ActiveModel.findOne({ driverId: req.driver.driverId });
    if (!active) {
      return res.status(404).json({ message: "Active roster record not found." });
    }

    const before = active.toObject();
    let changesApplied = false;

    if (availability !== undefined) {
      if (!["Online", "Offline"].includes(availability)) {
        return res.status(400).json({ message: "Availability must be 'Online' or 'Offline'." });
      }
      active.availability = availability;
      changesApplied = true;
    }

    if (status !== undefined) {
      if (!["Active", "Inactive"].includes(status)) {
        return res.status(400).json({ message: "Status must be 'Active' or 'Inactive'." });
      }
      active.status = status;
      changesApplied = true;
    }

    const point = toGeoPoint({ lat, lng, currentLocation });
    if (point) {
      active.currentLocation = point;
      changesApplied = true;
    }

    if (hoursOfService && typeof hoursOfService === "object") {
      if (!active.hoursOfService) active.hoursOfService = {};
      for (const [key, value] of Object.entries(hoursOfService)) {
        active.hoursOfService[key] = value;
      }
      changesApplied = true;
    }

    if (!changesApplied) {
      return res.status(400).json({ message: "No valid presence updates supplied." });
    }

    const after = active.toObject();
    const changes = diffChanges(before, after);
    if (changes.length) {
      active.history.push({
        changedBy: req.driver.driverId,
        note: note || "driver-app",
        changes,
        changedAt: new Date(),
      });
    }

    await active.save();

    emitToAdmins("driver:presence", {
      driverId: active.driverId,
      active: sanitizeActive(active),
    });

    return res.status(200).json({
      message: "Presence updated.",
      active: sanitizeActive(active),
    });
  } catch (error) {
    console.error("Driver presence update error:", error);
    return res.status(500).json({ message: "Server error while updating presence." });
  }
};

// Accept HOS deltas from driver app: { date: 'YYYY-MM-DD', minutes: 5 }
export const appendHos = async (req, res) => {
  try {
    const driverId = req.driver.driverId;
    const { date, minutes } = req.body || {};
    if (!date || !minutes) {
      return res.status(400).json({ message: 'date and minutes are required' });
    }

    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      return res.status(400).json({ message: 'minutes must be a positive number' });
    }

    // Append a new daily entry (append-only). Consumers will aggregate.
    await DriverHOSModel.create({ driverId, date, minutes: mins });

    return res.status(201).json({ message: 'HOS delta recorded' });
  } catch (err) {
    console.error('appendHos error', err);
    return res.status(500).json({ message: 'Failed to record HOS' });
  }
};

// Return rolling sum for the last N days (default 8)
export const getHosSummary = async (req, res) => {
  try {
    const driverId = req.params.driverId || req.driver.driverId;
    const days = Math.max(1, Math.min(30, Number(req.query.days || 8)));

    // compute date strings for the last N days (UTC)
    const end = new Date();
    const dates = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
      d.setUTCDate(d.getUTCDate() - i);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${day}`);
    }

    const rows = await DriverHOSModel.find({ driverId, date: { $in: dates } }).lean();
    const byDate = new Map();
    for (const r of rows) {
      byDate.set(r.date, (byDate.get(r.date) || 0) + Number(r.minutes || 0));
    }

    const totals = dates.map((d) => ({ date: d, minutes: byDate.get(d) || 0 }));
    const sum = totals.reduce((s, t) => s + t.minutes, 0);

    return res.status(200).json({ days: totals, sum });
  } catch (err) {
    console.error('getHosSummary error', err);
    return res.status(500).json({ message: 'Failed to fetch HOS summary' });
  }
};

// Diagnostics endpoint removed

export const uploadDiagnostics = async (req, res) => {
  try {
    // honor server-side toggle for diagnostics collection
    if (!config.diagnostics || !config.diagnostics.enabled) {
      return res.status(403).json({ message: "Diagnostics upload is disabled on this server." });
    }
    const driverId = req.driver.driverId;
    const body = req.body || {};
    // allow either single entry or array
    const entries = Array.isArray(body) ? body : [body];
    const docs = entries
      .map((e) => ({
        driverId,
        at: e.at ? new Date(e.at) : new Date(),
        level: e.level || 'info',
        tag: e.tag || null,
        message: e.message || null,
        payload: e.payload || null,
      }))
      .slice(0, 200); // guard against huge payloads

    if (docs.length === 0) return res.status(400).json({ message: 'No diagnostics entries supplied.' });

    try {
      await DriverDiagnosticsModel.insertMany(docs, { ordered: false });
    } catch (insertErr) {
      console.warn('Diagnostics insert partial failure', insertErr && insertErr.message ? insertErr.message : insertErr);
    }

    return res.status(201).json({ message: 'Diagnostics recorded.' });
  } catch (err) {
    console.error('uploadDiagnostics error', err);
    return res.status(500).json({ message: 'Failed to upload diagnostics.' });
  }
};
