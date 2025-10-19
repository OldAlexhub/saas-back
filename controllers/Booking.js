import ActiveModel from "../models/ActiveSchema.js";
import BookingModel from "../models/BookingSchema.js";
import { COMPANY_ID, CompanyModel } from "../models/CompanySchema.js";
import { emitToAdmins, emitToDriver } from "../realtime/index.js";
import { toAdminBookingPayload, toDriverBookingPayload } from "../realtime/payloads.js";
import { geocodeAddress, getDrivingDistanceMiles } from "../utils/mapbox.js";

// ---- Configurable guards ----
const LEAD_TIME_MINUTES = 15;
const CONFLICT_WINDOW_MINUTES = 20;

const NON_FINAL_STATUSES = ["Pending", "Assigned", "EnRoute", "PickedUp"];
const FINAL_STATUSES = ["Completed", "Cancelled", "NoShow"];

function minutesFromNow(min) {
  return new Date(Date.now() + min * 60 * 1000);
}

function addAudit(doc, { byUserId, action, before, after, note }) {
  doc.history.push({
    byUserId: byUserId || null,
    action,
    before,
    after,
    note,
  });
}

// Status transition timestamps
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

// Validate status transitions (simple, strict)
function isValidTransition(from, to) {
  const order = ["Pending", "Assigned", "EnRoute", "PickedUp", "Completed"];
  if (to === "Cancelled" || to === "NoShow") {
    return ["Pending", "Assigned", "EnRoute"].includes(from);
  }
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  return i !== -1 && j !== -1 && j === i + 1;
}

// Check Active layer for assignment integrity using driverId and/or cabNumber
async function validateActiveForAssignment({ driverId, cabNumber }) {
  const or = [];
  if (driverId) or.push({ driverId: String(driverId), status: "Active" });
  if (cabNumber) or.push({ cabNumber: String(cabNumber), status: "Active" });

  if (or.length === 0) return; // nothing to validate

  // If both provided, prefer a record matching both; else accept either
  const query = or.length > 1
    ? { $or: [{ driverId: String(driverId), cabNumber: String(cabNumber), status: "Active" }, ...or] }
    : { $or: or };

  const active = await ActiveModel.findOne(query).lean();
  if (!active) throw new Error("Assignment blocked: driver/cab not Active.");

  if (driverId) {
    const busy = await BookingModel.exists({
      driverId: String(driverId),
      status: { $in: ["Assigned", "EnRoute", "PickedUp"] },
    });
    if (busy) {
      throw new Error("Assignment blocked: driver currently has an active trip.");
    }
  }
}

// Check conflicts within a time window for same driver/cab
async function hasConflict({ bookingIdToIgnore, driverId, cabNumber, pickupTime }) {
  const rangeStart = new Date(pickupTime.getTime() - CONFLICT_WINDOW_MINUTES * 60 * 1000);
  const rangeEnd = new Date(pickupTime.getTime() + CONFLICT_WINDOW_MINUTES * 60 * 1000);

  const andConds = [{ status: { $in: NON_FINAL_STATUSES } }, { pickupTime: { $gte: rangeStart, $lte: rangeEnd } }];
  if (driverId) andConds.push({ driverId: String(driverId) });
  if (cabNumber) andConds.push({ cabNumber: String(cabNumber) });

  const query = { $and: andConds };
  if (bookingIdToIgnore) query._id = { $ne: bookingIdToIgnore };

  const conflict = await BookingModel.findOne(query)
    .select("_id status driverId cabNumber pickupTime")
    .lean();

  return !!conflict;
}

// Defaults (used if company profile doesn't specify settings)
const DEFAULT_AUTO_DISPATCH_MAX_DISTANCE_METERS = 10000; // ~6 miles
const DEFAULT_AUTO_DISPATCH_MAX_CANDIDATES = 20;
const DEFAULT_AUTO_DISPATCH_DISTANCE_STEPS_MILES = [1, 2, 3, 4, 5, 6];

async function loadDispatchSettings() {
  try {
    const company = await CompanyModel.findById(COMPANY_ID).lean();
    const ds = company?.dispatchSettings || {};
    const maxDistanceMiles = Number.isFinite(Number(ds.maxDistanceMiles)) ? Number(ds.maxDistanceMiles) : undefined;
    const maxCandidates = Number.isFinite(Number(ds.maxCandidates)) ? Number(ds.maxCandidates) : undefined;
    const distanceStepsMiles = Array.isArray(ds.distanceStepsMiles) ? ds.distanceStepsMiles.map(Number).filter((n) => Number.isFinite(n) && n > 0) : undefined;

    const maxDistanceMeters = (maxDistanceMiles !== undefined ? Math.round(maxDistanceMiles * 1609.34) : DEFAULT_AUTO_DISPATCH_MAX_DISTANCE_METERS);
    const candidates = maxCandidates !== undefined ? Math.max(1, Math.round(maxCandidates)) : DEFAULT_AUTO_DISPATCH_MAX_CANDIDATES;
    const stepsMiles = distanceStepsMiles && distanceStepsMiles.length ? distanceStepsMiles : DEFAULT_AUTO_DISPATCH_DISTANCE_STEPS_MILES;

    const stepsMeters = stepsMiles
      .map((miles) => Math.round(miles * 1609.34))
      .map((meters) => (meters > maxDistanceMeters ? maxDistanceMeters : meters))
      .filter((distance, index, array) => array.indexOf(distance) === index);

    return {
      maxDistanceMeters,
      maxCandidates: candidates,
      distanceStepsMeters: stepsMeters,
    };
  } catch (err) {
    console.warn('Unable to load company dispatch settings, falling back to defaults:', err.message);
    return {
      maxDistanceMeters: DEFAULT_AUTO_DISPATCH_MAX_DISTANCE_METERS,
      maxCandidates: DEFAULT_AUTO_DISPATCH_MAX_CANDIDATES,
      distanceStepsMeters: DEFAULT_AUTO_DISPATCH_DISTANCE_STEPS_MILES.map((m) => Math.round(m * 1609.34)),
    };
  }
}

function hasGeoPoint(point) {
  return (
    point &&
    point.type === "Point" &&
    Array.isArray(point.coordinates) &&
    point.coordinates.length === 2 &&
    point.coordinates.every((value) => typeof value === "number")
  );
}

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

const ALLOWED_DISTANCE_SOURCES = new Set(["driving", "straight-line", "computed", "manual"]);

function normalizeDistanceSource(source) {
  if (!source) return undefined;
  const normalized = String(source).toLowerCase();
  return ALLOWED_DISTANCE_SOURCES.has(normalized) ? normalized : undefined;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "1" || trimmed === "yes") return true;
    if (trimmed === "false" || trimmed === "0" || trimmed === "no") return false;
  }
  return Boolean(value);
}

function normalizeGeoPointInput(point, lon, lat) {
  if (hasGeoPoint(point)) {
    const [lonRaw, latRaw] = point.coordinates;
    const lonNum = toFiniteNumber(lonRaw);
    const latNum = toFiniteNumber(latRaw);
    if (lonNum !== undefined && latNum !== undefined) {
      return { type: "Point", coordinates: [lonNum, latNum] };
    }
  }

  const lonNum = toFiniteNumber(lon);
  const latNum = toFiniteNumber(lat);
  if (lonNum === undefined || latNum === undefined) return null;
  return { type: "Point", coordinates: [lonNum, latNum] };
}

function computeHaversineDistanceMiles(pointA, pointB) {
  if (!hasGeoPoint(pointA) || !hasGeoPoint(pointB)) return undefined;
  const [lon1, lat1] = pointA.coordinates;
  const [lon2, lat2] = pointB.coordinates;

  const toRadians = (deg) => (deg * Math.PI) / 180;
  const RADIUS_MILES = 3958.8;

  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const miles = RADIUS_MILES * c;

  return Number.isFinite(miles) && miles > 0 ? miles : undefined;
}

async function fetchDrivingDistanceMiles(pickupPoint, dropoffPoint) {
  try {
    if (!hasGeoPoint(pickupPoint) || !hasGeoPoint(dropoffPoint)) return undefined;
    const pickup = {
      lon: pickupPoint.coordinates[0],
      lat: pickupPoint.coordinates[1],
    };
    const dropoff = {
      lon: dropoffPoint.coordinates[0],
      lat: dropoffPoint.coordinates[1],
    };
    const miles = await getDrivingDistanceMiles({ pickup, dropoff });
    if (!Number.isFinite(miles) || miles <= 0) return undefined;
    return miles;
  } catch (err) {
    console.warn("Driving distance lookup failed:", err.message);
    return undefined;
  }
}

async function findAutomaticAssignment({ booking }) {
  const baseQuery = { status: "Active", availability: "Online" };
  const { maxDistanceMeters, maxCandidates: AUTO_DISPATCH_MAX_CANDIDATES, distanceStepsMeters: AUTO_DISPATCH_DISTANCE_STEPS_METERS } = await loadDispatchSettings();
  const pickupPoint = hasGeoPoint(booking.pickupPoint) ? booking.pickupPoint : null;
  const evaluated = new Set();
  const busyDriverCache = new Map();
  const declinedSet = new Set(
    Array.isArray(booking.declinedDrivers)
      ? booking.declinedDrivers
          .map((entry) => entry?.driverId)
          .filter((id) => id !== undefined && id !== null)
          .map((id) => String(id))
      : [],
  );

  const evaluateCandidate = async (candidate) => {
    if (!candidate || !candidate.driverId) return null;
    if (declinedSet.has(String(candidate.driverId))) {
      return null;
    }
    const candidateKeyParts = [candidate.driverId];
    if (candidate.cabNumber) candidateKeyParts.push(candidate.cabNumber);
    const candidateKey =
      candidateKeyParts.join("#") ||
      (candidate._id ? String(candidate._id) : undefined);

    if (candidateKey && evaluated.has(candidateKey)) {
      return null;
    }
    if (candidateKey) evaluated.add(candidateKey);

    const driverKey = String(candidate.driverId);
    if (busyDriverCache.has(driverKey)) {
      if (busyDriverCache.get(driverKey)) {
        return null;
      }
    } else {
      const activeTrip = await BookingModel.exists({
        driverId: candidate.driverId,
        status: { $in: ["Assigned", "EnRoute", "PickedUp"] },
      });
      busyDriverCache.set(driverKey, Boolean(activeTrip));
      if (activeTrip) {
        return null;
      }
    }

    const conflict = await hasConflict({
      bookingIdToIgnore: booking._id,
      driverId: candidate.driverId,
      cabNumber: candidate.cabNumber,
      pickupTime: booking.pickupTime,
    });

    if (conflict) return null;

    return {
      driverId: candidate.driverId,
      cabNumber: candidate.cabNumber,
    };
  };

  if (pickupPoint) {
    for (const maxDistance of AUTO_DISPATCH_DISTANCE_STEPS_METERS) {
      const radialCandidates = await ActiveModel.find({
        ...baseQuery,
        currentLocation: {
          $near: {
            $geometry: pickupPoint,
            $maxDistance: maxDistance,
          },
        },
      })
        .select("driverId cabNumber currentLocation updatedAt availability status")
        .limit(AUTO_DISPATCH_MAX_CANDIDATES)
        .lean();

      for (const candidate of radialCandidates) {
        const selection = await evaluateCandidate(candidate);
        if (selection) {
          return selection;
        }
      }
    }
  }

  const fallbackCandidates = await ActiveModel.find(baseQuery)
    .select("driverId cabNumber currentLocation updatedAt availability status")
    .sort({ "currentLocation.updatedAt": -1, updatedAt: -1 })
    .limit(AUTO_DISPATCH_MAX_CANDIDATES)
    .lean();

  for (const candidate of fallbackCandidates) {
    const selection = await evaluateCandidate(candidate);
    if (selection) {
      return selection;
    }
  }

  return null;
}

// ------------------ CONTROLLERS ------------------

// LIST
export const listBookings = async (req, res) => {
  try {
    const { status, from, to, driverId, cabNumber, limit } = req.query;
    const query = {};

    if (status) query.status = status;
    if (driverId) query.driverId = driverId;
    if (cabNumber) query.cabNumber = cabNumber;

    if (from || to) {
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;

      if ((from && Number.isNaN(fromDate.getTime())) || (to && Number.isNaN(toDate.getTime()))) {
        return res.status(400).json({ message: "from/to must be valid ISO date strings." });
      }

      query.pickupTime = {};
      if (fromDate) query.pickupTime.$gte = fromDate;
      if (toDate) query.pickupTime.$lte = toDate;
    }

    let mongoQuery = BookingModel.find(query).sort({ pickupTime: 1 });
    const limitVal = Number(limit);
    if (Number.isFinite(limitVal) && limitVal > 0) {
      mongoQuery = mongoQuery.limit(limitVal);
    }

    const bookings = await mongoQuery.lean();
    return res.status(200).json({ count: bookings.length, bookings });
  } catch (err) {
    console.error("listBookings error:", err);
    return res.status(500).json({ message: "Failed to fetch bookings", error: err.message });
  }
};

// GET SINGLE
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await BookingModel.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    return res.status(200).json({ booking });
  } catch (err) {
    console.error("getBookingById error:", err);
    return res.status(500).json({ message: "Failed to fetch booking", error: err.message });
  }
};

// CREATE
export const createBooking = async (req, res) => {
  try {
    const byUserId = req.user?.id || null;
    const {
      customerName,
      phoneNumber,
      pickupAddress,
      pickupTime,
      dropoffAddress,
      pickupLon,
      pickupLat,
      dropoffLon,
      dropoffLat,
      passengers,
      wheelchairNeeded,
      notes,
      estimatedFare: estimatedFareInput,
      fare: fareInput,
      dispatchMethod,
      noShowFeeApplied,
      pickupPoint: pickupPointInput,
      dropoffPoint: dropoffPointInput,
      estimatedDistanceMiles: estimatedDistanceMilesInput,
      estimatedDistance: estimatedDistanceInput,
      distance: distanceInput,
      estimatedDistanceSource: estimatedDistanceSourceInput,
      distanceSource: distanceSourceInput,
    } = req.body;

    if (!customerName || !phoneNumber || !pickupAddress || !pickupTime) {
      return res.status(400).json({ message: "customerName, phoneNumber, pickupAddress, pickupTime are required." });
    }

    const pTime = new Date(pickupTime);
    if (Number.isNaN(pTime.getTime())) {
      return res.status(400).json({ message: "pickupTime must be a valid ISO date." });
    }
    if (pTime < minutesFromNow(LEAD_TIME_MINUTES)) {
      return res.status(400).json({ message: `Pickup must be at least ${LEAD_TIME_MINUTES} minutes in the future.` });
    }

    let pickupLonNum = toFiniteNumber(pickupLon);
    let pickupLatNum = toFiniteNumber(pickupLat);
    let dropoffLonNum = toFiniteNumber(dropoffLon);
    let dropoffLatNum = toFiniteNumber(dropoffLat);

    let pickupPoint = normalizeGeoPointInput(pickupPointInput, pickupLonNum, pickupLatNum);
    let dropoffPoint = normalizeGeoPointInput(dropoffPointInput, dropoffLonNum, dropoffLatNum);

    try {
      if (pickupAddress) {
        const geocodedPickup = await geocodeAddress(pickupAddress, {
          proximity: dropoffPoint ? dropoffPoint.coordinates : undefined,
        });
        if (geocodedPickup) {
          pickupLonNum = geocodedPickup.lon;
          pickupLatNum = geocodedPickup.lat;
          pickupPoint = {
            type: "Point",
            coordinates: [pickupLonNum, pickupLatNum],
          };
        }
      }
    } catch (geoErr) {
      console.warn("Pickup geocode failed:", geoErr.message);
    }

    try {
      if (dropoffAddress) {
        const geocodedDropoff = await geocodeAddress(dropoffAddress, {
          proximity: pickupPoint ? pickupPoint.coordinates : undefined,
        });
        if (geocodedDropoff) {
          dropoffLonNum = geocodedDropoff.lon;
          dropoffLatNum = geocodedDropoff.lat;
          dropoffPoint = {
            type: "Point",
            coordinates: [dropoffLonNum, dropoffLatNum],
          };
        }
      }
    } catch (geoErr) {
      console.warn("Dropoff geocode failed:", geoErr.message);
    }

    if (pickupPoint && (pickupLonNum === undefined || pickupLatNum === undefined)) {
      pickupLonNum = pickupPoint.coordinates[0];
      pickupLatNum = pickupPoint.coordinates[1];
    }
    if (dropoffPoint && (dropoffLonNum === undefined || dropoffLatNum === undefined)) {
      dropoffLonNum = dropoffPoint.coordinates[0];
      dropoffLatNum = dropoffPoint.coordinates[1];
    }

    const distanceCandidates = [
      estimatedDistanceMilesInput,
      estimatedDistanceInput,
      distanceInput,
    ];

    let distanceMiles;
    for (const candidate of distanceCandidates) {
      const num = toFiniteNumber(candidate);
      if (num !== undefined && num > 0) {
        distanceMiles = num;
        break;
      }
    }

    let distanceSourceFinal =
      normalizeDistanceSource(distanceSourceInput) ||
      normalizeDistanceSource(estimatedDistanceSourceInput);

    if ((!distanceMiles || distanceMiles <= 0) && pickupPoint && dropoffPoint) {
      const drivingMiles = await fetchDrivingDistanceMiles(pickupPoint, dropoffPoint);
      if (drivingMiles !== undefined) {
        distanceMiles = Math.round(drivingMiles * 100) / 100;
        distanceSourceFinal = "driving";
      }
    }

    if ((!distanceMiles || distanceMiles <= 0) && pickupPoint && dropoffPoint) {
      const computed = computeHaversineDistanceMiles(pickupPoint, dropoffPoint);
      if (computed !== undefined) {
        distanceMiles = Math.round(computed * 100) / 100;
        if (!distanceSourceFinal) distanceSourceFinal = "straight-line";
      }
    }

    const fareCandidates = [estimatedFareInput, fareInput];
    let estimatedFareValue;
    for (const candidate of fareCandidates) {
      const num = toFiniteNumber(candidate);
      if (num !== undefined) {
        estimatedFareValue = num;
        break;
      }
    }

    let dispatchMethodNormalized;
    if (dispatchMethod) {
      const normalized = String(dispatchMethod).toLowerCase();
      if (!["manual", "auto"].includes(normalized)) {
        return res.status(400).json({ message: "dispatchMethod must be 'manual' or 'auto'." });
      }
      dispatchMethodNormalized = normalized;
    }

    const passengerRaw = toFiniteNumber(passengers);
    const passengerCount = passengerRaw !== undefined && passengerRaw > 0
      ? Math.max(1, Math.round(passengerRaw))
      : 1;

    const wheelchairRequired = wheelchairNeeded !== undefined ? toBoolean(wheelchairNeeded) : false;
    const noShowFeeAppliedValue =
      noShowFeeApplied !== undefined ? toBoolean(noShowFeeApplied) : undefined;

    const bookingPayload = {
      customerName,
      phoneNumber,
      pickupAddress,
      pickupTime: pTime,
      dropoffAddress,
      pickupLon: pickupLonNum,
      pickupLat: pickupLatNum,
      dropoffLon: dropoffLonNum,
      dropoffLat: dropoffLatNum,
      passengers: passengerCount,
      wheelchairNeeded: wheelchairRequired,
      notes,
    };

    if (pickupPoint) bookingPayload.pickupPoint = pickupPoint;
    if (dropoffPoint) bookingPayload.dropoffPoint = dropoffPoint;
    if (estimatedFareValue !== undefined) bookingPayload.estimatedFare = estimatedFareValue;
    if (distanceMiles !== undefined) {
      bookingPayload.estimatedDistanceMiles = distanceMiles;
      if (distanceSourceFinal) bookingPayload.estimatedDistanceSource = distanceSourceFinal;
    }
    if (dispatchMethodNormalized) bookingPayload.dispatchMethod = dispatchMethodNormalized;
    if (noShowFeeAppliedValue !== undefined) {
      bookingPayload.noShowFeeApplied = noShowFeeAppliedValue;
    }

    const booking = new BookingModel({
      ...bookingPayload,
    });

    addAudit(booking, { byUserId, action: "create", after: booking.toObject() });

    await booking.save();
    // If the request asked for automatic dispatch, attempt immediate auto-assignment
    if (dispatchMethodNormalized === 'auto') {
      // If we don't have pickup coords, we cannot run automatic dispatch — mark for reassignment
      if (!hasGeoPoint(booking.pickupPoint)) {
        booking.dispatchMethod = 'auto';
        booking.needs_reassignment = true;
        addAudit(booking, {
          byUserId,
          action: 'assign',
          before: null,
          after: {
            driverId: booking.driverId,
            cabNumber: booking.cabNumber,
            status: booking.status,
            dispatchMethod: booking.dispatchMethod,
            needs_reassignment: booking.needs_reassignment,
          },
          note: 'auto-dispatch-unassigned',
        });
        await booking.save();
        return res.status(201).json({ message: 'Booking created', booking, needsManual: true });
      }

      // Try to select a driver automatically
      const automaticSelection = await findAutomaticAssignment({ booking });
      if (!automaticSelection) {
        booking.dispatchMethod = 'auto';
        booking.needs_reassignment = true;
        addAudit(booking, {
          byUserId,
          action: 'assign',
          before: null,
          after: {
            driverId: booking.driverId,
            cabNumber: booking.cabNumber,
            status: booking.status,
            dispatchMethod: booking.dispatchMethod,
            needs_reassignment: booking.needs_reassignment,
          },
          note: 'auto-dispatch-unassigned',
        });
        await booking.save();
        return res.status(201).json({ message: 'Booking created', booking, needsManual: true });
      }

      const resolvedDriverId = automaticSelection.driverId;
      const resolvedCabNumber = automaticSelection.cabNumber;

      // validate and apply assignment
      try {
        await validateActiveForAssignment({ driverId: resolvedDriverId, cabNumber: resolvedCabNumber });
      } catch (validationError) {
        // If validation fails, mark for manual reassignment
        booking.dispatchMethod = 'auto';
        booking.needs_reassignment = true;
        addAudit(booking, {
          byUserId,
          action: 'assign',
          before: null,
          after: {
            driverId: booking.driverId,
            cabNumber: booking.cabNumber,
            status: booking.status,
            dispatchMethod: booking.dispatchMethod,
            needs_reassignment: booking.needs_reassignment,
          },
          note: 'auto-dispatch-validation-failed',
        });
        await booking.save();
        return res.status(201).json({ message: 'Booking created', booking, needsManual: true });
      }

      booking.driverId = resolvedDriverId;
      booking.cabNumber = resolvedCabNumber ?? null;
      booking.dispatchMethod = 'auto';
      booking.assignedAt = booking.assignedAt || new Date();
      if (booking.status === 'Pending') {
        booking.status = 'Assigned';
        stampStatusTime(booking, 'Assigned');
      }
      booking.needs_reassignment = false;

      addAudit(booking, {
        byUserId,
        action: 'assign',
        before: null,
        after: {
          driverId: booking.driverId,
          cabNumber: booking.cabNumber,
          status: booking.status,
          dispatchMethod: booking.dispatchMethod,
          needs_reassignment: booking.needs_reassignment,
        },
        note: 'auto-dispatch',
      });

      await booking.save();

      const driverPayload = toDriverBookingPayload(booking);
      if (driverPayload?.driverId) {
        emitToDriver(driverPayload.driverId, 'assignment:new', driverPayload);
      }
      emitToAdmins('assignment:updated', {
        event: 'assigned',
        booking: toAdminBookingPayload(booking),
      });

      return res.status(201).json({ message: 'Booking created and assigned', booking });
    }

    return res.status(201).json({ message: "Booking created", booking });
  } catch (err) {
    console.error("createBooking error:", err);
    return res.status(500).json({ message: "Failed to create booking", error: err.message });
  }
};

// ASSIGN (via driverId/cabNumber from Active)
export const assignBooking = async (req, res) => {
  try {
    const byUserId = req.user?.id || null;
    const { id } = req.params; // booking _id
    const {
      driverId: providedDriverId,
      cabNumber: providedCabNumber,
      dispatchMethod = "manual",
    } = req.body;

    const booking = await BookingModel.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (FINAL_STATUSES.includes(booking.status)) {
      return res.status(400).json({ message: `Cannot assign a ${booking.status} booking.` });
    }

    if (booking.tripSource === "driver" || booking.dispatchMethod === "flagdown") {
      return res.status(400).json({ message: "Flagdown trips cannot be reassigned." });
    }

    const previousAssignment = {
      driverId: booking.driverId,
      cabNumber: booking.cabNumber,
      status: booking.status,
      dispatchMethod: booking.dispatchMethod,
      needs_reassignment: booking.needs_reassignment,
    };

    const method = dispatchMethod === "auto" ? "auto" : "manual";
    let resolvedDriverId = providedDriverId;
    let resolvedCabNumber = providedCabNumber;

    if (method === "manual") {
      if (!resolvedDriverId && !resolvedCabNumber) {
        return res.status(400).json({ message: "Provide a driverId or cabNumber for manual assignment." });
      }

      // Guard: Active assignment
      try {
        await validateActiveForAssignment({ driverId: resolvedDriverId, cabNumber: resolvedCabNumber });
      } catch (validationError) {
        return res.status(400).json({ message: validationError.message });
      }

      // Guard: Conflict window (±20 min)
      if (
        await hasConflict({
          bookingIdToIgnore: id,
          driverId: resolvedDriverId,
          cabNumber: resolvedCabNumber,
          pickupTime: booking.pickupTime,
        })
      ) {
        return res.status(409).json({ message: "Assignment conflict within time window for driver/cab." });
      }
    } else {
      if (!hasGeoPoint(booking.pickupPoint)) {
        return res.status(400).json({
          message: "Automatic dispatch requires pickup coordinates (pickupLon/pickupLat).",
        });
      }

      const automaticSelection = await findAutomaticAssignment({ booking });
      if (!automaticSelection) {
        booking.dispatchMethod = "auto";
        booking.needs_reassignment = true;

        addAudit(booking, {
          byUserId,
          action: "assign",
          before: previousAssignment,
          after: {
            driverId: booking.driverId,
            cabNumber: booking.cabNumber,
            status: booking.status,
            dispatchMethod: booking.dispatchMethod,
            needs_reassignment: booking.needs_reassignment,
          },
          note: "auto-dispatch-unassigned",
        });

        await booking.save();

        return res.status(409).json({
          message: "No available drivers found for automatic dispatch.",
          needsManual: true,
        });
      }

      resolvedDriverId = automaticSelection.driverId;
      resolvedCabNumber = automaticSelection.cabNumber;

      await validateActiveForAssignment({ driverId: resolvedDriverId, cabNumber: resolvedCabNumber });
    }

    booking.driverId = resolvedDriverId ?? booking.driverId ?? null;
    if (Array.isArray(booking.declinedDrivers) && resolvedDriverId) {
      const resolvedKey = String(resolvedDriverId);
      booking.declinedDrivers = booking.declinedDrivers.filter((entry) => {
        if (!entry || entry.driverId == null) return false;
        return String(entry.driverId) !== resolvedKey;
      });
    }
    booking.cabNumber = resolvedCabNumber ?? booking.cabNumber ?? null;
    booking.dispatchMethod = method;
    booking.assignedAt = booking.assignedAt || new Date();

    // If booking is still Pending, move to Assigned
    if (booking.status === "Pending") {
      booking.status = "Assigned";
      stampStatusTime(booking, "Assigned");
    }

    booking.needs_reassignment = false;

    addAudit(booking, {
      byUserId,
      action: "assign",
      before: previousAssignment,
      after: {
        driverId: booking.driverId,
        cabNumber: booking.cabNumber,
        status: booking.status,
        dispatchMethod: booking.dispatchMethod,
        needs_reassignment: booking.needs_reassignment,
      },
      note: method === "auto" ? "auto-dispatch" : undefined,
    });
    await booking.save();

    const driverPayload = toDriverBookingPayload(booking);
    if (driverPayload?.driverId) {
      emitToDriver(driverPayload.driverId, "assignment:new", driverPayload);
    }
    if (previousAssignment.driverId && previousAssignment.driverId !== booking.driverId) {
      emitToDriver(previousAssignment.driverId, "assignment:cancelled", {
        id: booking._id.toString(),
        bookingId: booking.bookingId,
      });
    }
    emitToAdmins("assignment:updated", {
      event: "assigned",
      booking: toAdminBookingPayload(booking),
    });

    return res.status(200).json({ message: "Booking assigned", booking });
  } catch (err) {
    console.error("assignBooking error:", err);
    return res.status(500).json({ message: "Failed to assign booking", error: err.message });
  }
};

// GENERIC UPDATE (fields allowed while not final)
export const updateBooking = async (req, res) => {
  try {
    const byUserId = req.user?.id || null;
    const { id } = req.params;
    const payload = { ...req.body };

    // Never allow bookingId to change
    delete payload.bookingId;
    delete payload.tripSource;
    delete payload.flagdown;
    delete payload.driverLocation;
    delete payload.driverLocationTrail;

    if (payload.passengers !== undefined) {
      const passengersNum = toFiniteNumber(payload.passengers);
      if (passengersNum === undefined || passengersNum <= 0) {
        return res.status(400).json({ message: "passengers must be a positive number." });
      }
      payload.passengers = Math.max(1, Math.round(passengersNum));
    }

    const coordinateKeys = ["pickupLon", "pickupLat", "dropoffLon", "dropoffLat"];
    for (const key of coordinateKeys) {
      if (payload[key] !== undefined) {
        const num = toFiniteNumber(payload[key]);
        if (num === undefined) {
          return res.status(400).json({ message: `${key} must be a valid number.` });
        }
        payload[key] = num;
      }
    }

    if (payload.wheelchairNeeded !== undefined) {
      payload.wheelchairNeeded = toBoolean(payload.wheelchairNeeded);
    }

    if (payload.noShowFeeApplied !== undefined) {
      payload.noShowFeeApplied = toBoolean(payload.noShowFeeApplied);
    }

    if (payload.fare !== undefined && payload.estimatedFare === undefined) {
      payload.estimatedFare = payload.fare;
    }
    delete payload.fare;

    if (payload.estimatedFare !== undefined) {
      const fareNum = toFiniteNumber(payload.estimatedFare);
      if (fareNum === undefined) {
        return res.status(400).json({ message: "estimatedFare must be a valid number." });
      }
      payload.estimatedFare = fareNum;
    }

    const distanceCandidatesUpdate = [
      payload.estimatedDistanceMiles,
      payload.estimatedDistance,
      payload.distance,
    ];

    let updatedDistanceMiles;
    for (const candidate of distanceCandidatesUpdate) {
      const num = toFiniteNumber(candidate);
      if (num !== undefined && num > 0) {
        updatedDistanceMiles = num;
        break;
      }
    }

    if (updatedDistanceMiles !== undefined) {
      payload.estimatedDistanceMiles = updatedDistanceMiles;
    } else if (payload.estimatedDistanceMiles !== undefined) {
      delete payload.estimatedDistanceMiles;
    }
    delete payload.distance;
    delete payload.estimatedDistance;

    const distanceSourceUpdate =
      normalizeDistanceSource(payload.distanceSource) ||
      normalizeDistanceSource(payload.estimatedDistanceSource);
    delete payload.distanceSource;
    if (distanceSourceUpdate) {
      payload.estimatedDistanceSource = distanceSourceUpdate;
    } else if (payload.estimatedDistanceSource !== undefined) {
      if (payload.estimatedDistanceMiles === undefined) {
        delete payload.estimatedDistanceSource;
      } else {
        const normalizedExisting = normalizeDistanceSource(payload.estimatedDistanceSource);
        payload.estimatedDistanceSource = normalizedExisting;
      }
    }

    if (payload.pickupPoint !== undefined) {
      if (payload.pickupPoint === null) {
        payload.pickupPoint = { type: "Point", coordinates: undefined };
      } else {
        const normalized = normalizeGeoPointInput(
          payload.pickupPoint,
          payload.pickupLon,
          payload.pickupLat
        );
        if (!normalized) {
          return res.status(400).json({ message: "pickupPoint must include valid lon/lat coordinates." });
        }
        if (payload.pickupLon === undefined) payload.pickupLon = normalized.coordinates[0];
        if (payload.pickupLat === undefined) payload.pickupLat = normalized.coordinates[1];
        payload.pickupPoint = normalized;
      }
    }

    if (payload.dropoffPoint !== undefined) {
      if (payload.dropoffPoint === null) {
        payload.dropoffPoint = { type: "Point", coordinates: undefined };
      } else {
        const normalized = normalizeGeoPointInput(
          payload.dropoffPoint,
          payload.dropoffLon,
          payload.dropoffLat
        );
        if (!normalized) {
          return res
            .status(400)
            .json({ message: "dropoffPoint must include valid lon/lat coordinates." });
        }
        if (payload.dropoffLon === undefined) payload.dropoffLon = normalized.coordinates[0];
        if (payload.dropoffLat === undefined) payload.dropoffLat = normalized.coordinates[1];
        payload.dropoffPoint = normalized;
      }
    }

    if (payload.dispatchMethod) {
      const normalizedDispatch = String(payload.dispatchMethod).toLowerCase();
      if (!["manual", "auto"].includes(normalizedDispatch)) {
        return res.status(400).json({ message: "dispatchMethod must be 'manual' or 'auto'." });
      }
      payload.dispatchMethod = normalizedDispatch;
    }

    // If pickupTime is being updated, enforce lead time
    if (payload.pickupTime) {
      const pt = new Date(payload.pickupTime);
      if (Number.isNaN(pt.getTime())) return res.status(400).json({ message: "pickupTime must be a valid ISO date." });
      if (pt < minutesFromNow(LEAD_TIME_MINUTES)) {
        return res.status(400).json({ message: `Pickup must be at least ${LEAD_TIME_MINUTES} minutes in the future.` });
      }
      payload.pickupTime = pt;
    }

    const booking = await BookingModel.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (FINAL_STATUSES.includes(booking.status)) {
      return res.status(400).json({ message: `Cannot update a ${booking.status} booking.` });
    }

    const previousStatus = booking.status;
    const before = booking.toObject();

    // If pickupTime changes, check conflicts for already assigned driver/cab
    if (payload.pickupTime && (booking.driverId || booking.cabNumber)) {
      const conflict = await hasConflict({
        bookingIdToIgnore: id,
        driverId: booking.driverId,
        cabNumber: booking.cabNumber,
        pickupTime: payload.pickupTime,
      });
      if (conflict) return res.status(409).json({ message: "New pickupTime conflicts for assigned driver/cab." });
    }

    // Apply updates
    Object.assign(booking, payload);

    const normalizedPickupPoint = normalizeGeoPointInput(
      booking.pickupPoint,
      booking.pickupLon,
      booking.pickupLat
    );
    const normalizedDropoffPoint = normalizeGeoPointInput(
      booking.dropoffPoint,
      booking.dropoffLon,
      booking.dropoffLat
    );

    if (normalizedPickupPoint) booking.pickupPoint = normalizedPickupPoint;
    if (normalizedDropoffPoint) booking.dropoffPoint = normalizedDropoffPoint;

    if (normalizedPickupPoint && normalizedDropoffPoint) {
      const osrmMiles = await fetchDrivingDistanceMiles(
        normalizedPickupPoint,
        normalizedDropoffPoint
      );
      if (osrmMiles !== undefined) {
        booking.estimatedDistanceMiles = Math.round(osrmMiles * 100) / 100;
        booking.estimatedDistanceSource = "driving";
      } else if (!booking.estimatedDistanceMiles) {
        const computed = computeHaversineDistanceMiles(
          normalizedPickupPoint,
          normalizedDropoffPoint
        );
        if (computed !== undefined) {
          booking.estimatedDistanceMiles = Math.round(computed * 100) / 100;
          if (!booking.estimatedDistanceSource) {
            booking.estimatedDistanceSource = "computed";
          }
        }
      }
    }

    addAudit(booking, {
      byUserId,
      action: "update",
      before,
      after: booking.toObject(),
    });

    await booking.save();
    return res.status(200).json({ message: "Booking updated", booking });
  } catch (err) {
    console.error("updateBooking error:", err);
    return res.status(500).json({ message: "Failed to update booking", error: err.message });
  }
};

// STATUS CHANGE (forward step or cancel/no-show)
export const changeStatus = async (req, res) => {
  try {
    const byUserId = req.user?.id || null;
    const { id } = req.params;
    const { toStatus, cancelReason, cancelledBy, noShowFeeApplied } = req.body;

    if (!toStatus) return res.status(400).json({ message: "toStatus is required." });

    const booking = await BookingModel.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (FINAL_STATUSES.includes(booking.status)) {
      return res.status(400).json({ message: `Booking already ${booking.status}.` });
    }

    if (!isValidTransition(booking.status, toStatus)) {
      return res.status(400).json({ message: `Invalid transition ${booking.status} → ${toStatus}.` });
    }

    // Guards for progression
    if (toStatus === "Assigned" && !(booking.driverId || booking.cabNumber)) {
      return res.status(400).json({ message: "Assign a driver or cab before setting status to Assigned." });
    }
    if (toStatus === "EnRoute" && booking.status !== "Assigned") {
      return res.status(400).json({ message: "Booking must be Assigned to move EnRoute." });
    }
    if (toStatus === "PickedUp" && booking.status !== "EnRoute") {
      return res.status(400).json({ message: "Booking must be EnRoute to move PickedUp." });
    }
    if (toStatus === "Completed" && booking.status !== "PickedUp") {
      return res.status(400).json({ message: "Booking must be PickedUp to Complete." });
    }

    const before = booking.toObject();

    // Extra fields for cancel / no-show
    if (toStatus === "Cancelled") {
      booking.cancelledBy = cancelledBy || "dispatcher";
      if (cancelReason) booking.cancelReason = cancelReason;
    }
    if (toStatus === "NoShow") {
      if (typeof noShowFeeApplied === "boolean") booking.noShowFeeApplied = noShowFeeApplied;
    }

    booking.status = toStatus;
    stampStatusTime(booking, toStatus);

    addAudit(booking, {
      byUserId,
      action: "status",
      before,
      after: { status: toStatus, cancelledBy: booking.cancelledBy, cancelReason: booking.cancelReason },
    });

    await booking.save();

    if (booking.driverId) {
      emitToDriver(booking.driverId, "booking:status", {
        event: "status",
        previousStatus,
        booking: toDriverBookingPayload(booking),
      });
    }
    emitToAdmins("assignment:updated", {
      event: "status",
      previousStatus,
      booking: toAdminBookingPayload(booking),
    });

    return res.status(200).json({ message: "Status updated", booking });
  } catch (err) {
    console.error("changeStatus error:", err);
    return res.status(500).json({ message: "Failed to change status", error: err.message });
  }
};

// CANCEL (shortcut)
export const cancelBooking = async (req, res) => {
  req.body.toStatus = "Cancelled";
  return changeStatus(req, res);
};
