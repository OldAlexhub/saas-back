import ActiveModel from "../models/ActiveSchema.js";
import NemtRunModel from "../models/NemtRunSchema.js";
import NemtTripModel from "../models/NemtTripSchema.js";
import { NEMT_SETTINGS_ID, NemtSettingsModel } from "../models/NemtSettingsSchema.js";
import { saveWithIdRetry } from "../utils/saveWithRetry.js";
import { getCapacityIssues } from "./nemtCapacity.js";
import { optimizeRunDetailed } from "./nemtOptimizer.js";

const MUTABLE_RUN_STATUSES = ["Unassigned", "Assigned"];

function startOfUtcDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function nextUtcDay(value) {
  const date = startOfUtcDay(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function idOf(doc) {
  return doc?._id?.toString?.() || String(doc?._id || "");
}

function hasCoords(lon, lat) {
  return Number.isFinite(Number(lon)) && Number.isFinite(Number(lat));
}

function haversineMiles(lon1, lat1, lon2, lat2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function driverPosition(driver) {
  const coords = driver?.currentLocation?.coordinates;
  if (Array.isArray(coords) && hasCoords(coords[0], coords[1])) {
    return { lon: Number(coords[0]), lat: Number(coords[1]) };
  }
  return null;
}

function tripPickupPosition(trip) {
  if (hasCoords(trip?.pickupLon, trip?.pickupLat)) {
    return { lon: Number(trip.pickupLon), lat: Number(trip.pickupLat) };
  }
  return null;
}

function tripEndPosition(trip) {
  if (hasCoords(trip?.dropoffLon, trip?.dropoffLat)) {
    return { lon: Number(trip.dropoffLon), lat: Number(trip.dropoffLat) };
  }
  return tripPickupPosition(trip);
}

function serviceDateLabel(date) {
  return date.toISOString().slice(0, 10);
}

function tripTimeMs(trip) {
  const date = trip?.scheduledPickupTime ? new Date(trip.scheduledPickupTime) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : Number.MAX_SAFE_INTEGER;
}

function scoreBucket(bucket, trip) {
  const pickup = tripPickupPosition(trip);
  const lastTrip = bucket.trips[bucket.trips.length - 1];
  const origin = lastTrip ? tripEndPosition(lastTrip) : driverPosition(bucket.driver);

  let distancePenalty = 0;
  if (origin && pickup) {
    distancePenalty = haversineMiles(origin.lon, origin.lat, pickup.lon, pickup.lat);
  } else if (!pickup) {
    distancePenalty = 25;
  }

  let timePenalty = 0;
  if (lastTrip) {
    const gapMinutes = Math.abs(tripTimeMs(trip) - tripTimeMs(lastTrip)) / 60_000;
    timePenalty = Math.min(gapMinutes / 30, 10);
  }

  return distancePenalty + timePenalty + bucket.trips.length * 1.5;
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function resequenceAndSyncTrips(run, orderedIds) {
  const ops = orderedIds.map((tripId, index) =>
    NemtTripModel.updateOne(
      { _id: tripId },
      {
        $set: {
          runId: run._id,
          runSequence: index,
          status: "Assigned",
          driverId: run.driverId || null,
          cabNumber: run.cabNumber || null,
          assignedAt: new Date(),
        },
      }
    )
  );
  await Promise.all(ops);
}

// Estimate whether a trip will miss its pickup window given the travel time required.
function pickupWindowWarning(trip, bucket, avgMph) {
  const pickup = tripPickupPosition(trip);
  const windowLatest = trip.pickupWindowLatest ? new Date(trip.pickupWindowLatest) : null;
  if (!windowLatest || Number.isNaN(windowLatest.getTime())) return null;

  const lastTrip = bucket.trips[bucket.trips.length - 1];
  const origin = lastTrip ? tripEndPosition(lastTrip) : driverPosition(bucket.driver);
  if (!origin || !pickup || !avgMph) return null;

  const distMiles = haversineMiles(origin.lon, origin.lat, pickup.lon, pickup.lat);
  const travelMinutes = (distMiles / avgMph) * 60;
  const referenceTime = lastTrip?.scheduledPickupTime
    ? new Date(lastTrip.scheduledPickupTime).getTime()
    : Date.now();
  const estimatedArrivalMs = referenceTime + travelMinutes * 60_000;

  if (estimatedArrivalMs > windowLatest.getTime()) {
    const overshootMin = Math.round((estimatedArrivalMs - windowLatest.getTime()) / 60_000);
    return `Trip #${trip.tripId || idOf(trip).slice(-6)} may miss its pickup window by ~${overshootMin} min.`;
  }
  return null;
}

export async function autoAssignTripsToRuns({
  serviceDate,
  driverIds = [],
  maxTripsPerRun,
  commit = true,
} = {}) {
  const day = startOfUtcDay(serviceDate);
  const nextDay = nextUtcDay(serviceDate);
  if (!day || !nextDay) throw createError("serviceDate is required and must be a valid date.");

  // Load settings first so we can apply onlineDriversOnly and defaultMaxTripsPerRun
  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  const onlineOnly = settings?.onlineDriversOnly !== false; // default true
  const maxTrips = Math.min(40, Math.max(1, Number(maxTripsPerRun ?? settings?.defaultMaxTripsPerRun ?? 12)));
  const avgMph = Number(settings?.avgMphForOptimization ?? 25);

  const driverFilter = { status: "Active" };
  if (onlineOnly) driverFilter.availability = "Online";
  if (Array.isArray(driverIds) && driverIds.length) {
    driverFilter.driverId = { $in: driverIds.map(String) };
  }

  const [drivers, trips, existingRuns] = await Promise.all([
    ActiveModel.find(driverFilter).sort({ cabNumber: 1, driverId: 1 }).lean(),
    NemtTripModel.find({
      serviceDate: { $gte: day, $lt: nextDay },
      status: "Scheduled",
      $or: [{ runId: null }, { runId: { $exists: false } }],
    })
      .sort({ scheduledPickupTime: 1, pickupAddress: 1 })
      .lean(),
    NemtRunModel.find({
      serviceDate: { $gte: day, $lt: nextDay },
      status: { $in: MUTABLE_RUN_STATUSES },
      ...(Array.isArray(driverIds) && driverIds.length ? { driverId: { $in: driverIds.map(String) } } : {}),
    })
      .populate("trips")
      .lean(),
  ]);

  if (!drivers.length) {
    const qualifier = onlineOnly ? "online and active" : "active";
    throw createError(`No ${qualifier} drivers are available for automatic NEMT assignment.`, 409);
  }

  const driverById = new Map(drivers.map((driver) => [String(driver.driverId), driver]));
  const buckets = [];

  for (const run of existingRuns) {
    const driver = driverById.get(String(run.driverId));
    if (!driver) continue;
    buckets.push({
      existingRunId: run._id,
      driver,
      driverId: String(run.driverId),
      cabNumber: run.cabNumber || driver.cabNumber || "",
      trips: Array.isArray(run.trips) ? [...run.trips] : [],
      newTrips: [],
    });
  }

  for (const driver of drivers) {
    if (!buckets.some((bucket) => bucket.driverId === String(driver.driverId))) {
      buckets.push({
        existingRunId: null,
        driver,
        driverId: String(driver.driverId),
        cabNumber: driver.cabNumber || "",
        trips: [],
        newTrips: [],
      });
    }
  }

  const warnings = [];
  for (const trip of trips) {
    let candidates = buckets.filter((bucket) => bucket.trips.length < maxTrips);
    const supportedCandidates = candidates.filter((bucket) => getCapacityIssues(bucket.driver, trip).length === 0);
    if (supportedCandidates.length) {
      candidates = supportedCandidates;
    } else {
      const issues = getCapacityIssues(candidates[0]?.driver || {}, trip);
      if (issues.length) {
        warnings.push(`Trip #${trip.tripId || idOf(trip).slice(-6)} has no available fully compatible vehicle: ${issues.join(" ")}`);
      }
    }
    if (!candidates.length) {
      const driver = drivers
        .map((candidate) => ({
          driver: candidate,
          load: buckets
            .filter((bucket) => bucket.driverId === String(candidate.driverId))
            .reduce((sum, bucket) => sum + bucket.trips.length, 0),
        }))
        .sort((a, b) => a.load - b.load)[0].driver;
      const extraBucket = {
        existingRunId: null,
        driver,
        driverId: String(driver.driverId),
        cabNumber: driver.cabNumber || "",
        trips: [],
        newTrips: [],
      };
      buckets.push(extraBucket);
      candidates = [extraBucket];
    }

    const bucket = candidates.sort((a, b) => scoreBucket(a, trip) - scoreBucket(b, trip))[0];

    // Warn if trip may miss its pickup window given estimated travel time
    const windowWarn = pickupWindowWarning(trip, bucket, avgMph);
    if (windowWarn) warnings.push(windowWarn);

    bucket.trips.push(trip);
    bucket.newTrips.push(trip);
  }

  const plannedBuckets = buckets.filter((bucket) => bucket.newTrips.length > 0);
  const plannedRuns = plannedBuckets.map((bucket) => {
    const optimized = optimizeRunDetailed(bucket.trips, settings);
    return {
      existingRunId: bucket.existingRunId?.toString?.() || null,
      driverId: bucket.driverId,
      cabNumber: bucket.cabNumber,
      tripCount: bucket.trips.length,
      newTripCount: bucket.newTrips.length,
      tripIds: optimized.orderedIds,
      newTripIds: bucket.newTrips.map(idOf),
      changedCount: optimized.changedCount,
      warnings: optimized.warnings,
    };
  });

  if (!commit || !plannedRuns.length) {
    return {
      committed: false,
      serviceDate: serviceDateLabel(day),
      tripCount: trips.length,
      runCount: plannedRuns.length,
      warnings: [...new Set(warnings)].slice(0, 50),
      runs: plannedRuns,
    };
  }

  const committedRuns = [];
  for (const planned of plannedRuns) {
    let run = planned.existingRunId ? await NemtRunModel.findById(planned.existingRunId) : null;
    if (!run) {
      const driver = driverById.get(planned.driverId);
      run = new NemtRunModel({
        serviceDate: day,
        label: `NEMT ${serviceDateLabel(day)} ${planned.driverId}`,
        driverId: planned.driverId,
        cabNumber: planned.cabNumber || driver?.cabNumber || "",
        status: "Assigned",
      });
    }

    run.trips = planned.tripIds;
    run.tripCount = planned.tripIds.length;
    if ((run.driverId || run.cabNumber) && run.status === "Unassigned") {
      run.status = "Assigned";
    }
    run.optimizationVersion += 1;
    run.optimizedAt = new Date();
    if (!Array.isArray(run.history)) run.history = [];
    run.history.push({
      action: "auto_assign",
      after: {
        tripCount: run.tripCount,
        newTripCount: planned.newTripCount,
        changedCount: planned.changedCount,
      },
      note: "Automatic NEMT assignment",
    });
    await saveWithIdRetry(() => run.save(), ["runId"]);
    await resequenceAndSyncTrips(run, planned.tripIds);

    const populated = await NemtRunModel.findById(run._id).populate("trips").lean();
    committedRuns.push(populated);
  }

  return {
    committed: true,
    serviceDate: serviceDateLabel(day),
    tripCount: trips.length,
    runCount: committedRuns.length,
    warnings: [...new Set(warnings)].slice(0, 50),
    runs: committedRuns,
  };
}
