// NEMT run optimizer for small-fleet operations.
//
// This is intentionally deterministic and dependency-free. It is not a full
// traffic/time-matrix optimizer, but it now behaves like an operations tool:
// locked stops stay fixed, pickup windows/appointments drive priority, nearby
// stops are clustered, and the caller gets warnings/change counts.

const LOCKED_STATUSES = new Set([
  "EnRoute",
  "ArrivedPickup",
  "PickedUp",
  "ArrivedDrop",
  "Completed",
  "Cancelled",
  "NoShow",
  "PassengerCancelled",
]);

const DEFAULT_AVERAGE_MPH = 24;

function idOf(trip) {
  return trip?._id?.toString?.() || String(trip?._id || "");
}

function timeMs(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
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

function hasPickupCoords(trip) {
  return Number.isFinite(Number(trip?.pickupLon)) && Number.isFinite(Number(trip?.pickupLat));
}

function hasDropoffCoords(trip) {
  return Number.isFinite(Number(trip?.dropoffLon)) && Number.isFinite(Number(trip?.dropoffLat));
}

function distanceFrom(position, trip) {
  if (!position || !hasPickupCoords(trip)) return Number.POSITIVE_INFINITY;
  return haversineMiles(position.lon, position.lat, Number(trip.pickupLon), Number(trip.pickupLat));
}

function tripDeadlineMs(trip, settings) {
  const windowLatest = timeMs(trip.pickupWindowLatest);
  if (windowLatest) return windowLatest;
  const appointment = timeMs(trip.appointmentTime);
  if (appointment) {
    const buffer = Number(settings?.appointmentBufferMinutes ?? 15);
    return appointment - buffer * 60_000;
  }
  return timeMs(trip.scheduledPickupTime) ?? Number.MAX_SAFE_INTEGER;
}

function tripAnchorMs(trip, settings) {
  const scheduled = timeMs(trip.scheduledPickupTime);
  const earliest = timeMs(trip.pickupWindowEarliest);
  const deadline = tripDeadlineMs(trip, settings);
  return Math.min(
    scheduled ?? Number.MAX_SAFE_INTEGER,
    earliest ?? Number.MAX_SAFE_INTEGER,
    deadline ?? Number.MAX_SAFE_INTEGER
  );
}

function pushTripWarnings(trip, warnings) {
  const label = trip.tripId ? `#${trip.tripId}` : idOf(trip).slice(-6);
  if (!trip.scheduledPickupTime) warnings.push(`Trip ${label} has no scheduled pickup time.`);
  if (!hasPickupCoords(trip)) warnings.push(`Trip ${label} is missing pickup coordinates.`);
  if (!hasDropoffCoords(trip)) warnings.push(`Trip ${label} is missing dropoff coordinates.`);
  const scheduled = timeMs(trip.scheduledPickupTime);
  const latest = timeMs(trip.pickupWindowLatest);
  if (scheduled && latest && scheduled > latest) {
    warnings.push(`Trip ${label} pickup time is after its pickup window.`);
  }
  const appointment = timeMs(trip.appointmentTime);
  if (scheduled && appointment && scheduled > appointment) {
    warnings.push(`Trip ${label} pickup is after appointment time.`);
  }
}

function optimizeUnlockedSegment(segment, settings, warnings) {
  if (segment.length <= 1) return segment;
  const clusterWindowMs = Math.max(1, Number(settings?.clusterWindowMinutes ?? 20)) * 60_000;
  const averageMph = Math.max(5, Number(settings?.averageMph ?? DEFAULT_AVERAGE_MPH));

  const remaining = [...segment].sort((a, b) => tripAnchorMs(a, settings) - tripAnchorMs(b, settings));
  const ordered = [];
  let position = null;
  let currentClock = tripAnchorMs(remaining[0], settings);

  while (remaining.length) {
    const anchor = tripAnchorMs(remaining[0], settings);
    const candidates = remaining.filter((trip) => Math.abs(tripAnchorMs(trip, settings) - anchor) <= clusterWindowMs);

    candidates.sort((a, b) => {
      const distA = distanceFrom(position, a);
      const distB = distanceFrom(position, b);
      const deadlineA = tripDeadlineMs(a, settings);
      const deadlineB = tripDeadlineMs(b, settings);

      const etaA = Number.isFinite(distA) ? currentClock + (distA / averageMph) * 60 * 60_000 : currentClock;
      const etaB = Number.isFinite(distB) ? currentClock + (distB / averageMph) * 60 * 60_000 : currentClock;
      const lateA = Math.max(0, etaA - deadlineA);
      const lateB = Math.max(0, etaB - deadlineB);

      if (lateA !== lateB) return lateA - lateB;
      if (deadlineA !== deadlineB) return deadlineA - deadlineB;
      if (distA !== distB) return distA - distB;
      return tripAnchorMs(a, settings) - tripAnchorMs(b, settings);
    });

    const next = candidates[0];
    ordered.push(next);
    remaining.splice(remaining.findIndex((trip) => idOf(trip) === idOf(next)), 1);

    const dist = distanceFrom(position, next);
    if (Number.isFinite(dist)) {
      currentClock += (dist / averageMph) * 60 * 60_000;
    }
    currentClock = Math.max(currentClock, timeMs(next.scheduledPickupTime) ?? currentClock);
    if (hasDropoffCoords(next)) {
      position = { lon: Number(next.dropoffLon), lat: Number(next.dropoffLat) };
    } else if (hasPickupCoords(next)) {
      position = { lon: Number(next.pickupLon), lat: Number(next.pickupLat) };
    }

    const deadline = tripDeadlineMs(next, settings);
    if (Number.isFinite(deadline) && currentClock > deadline) {
      const label = next.tripId ? `#${next.tripId}` : idOf(next).slice(-6);
      warnings.push(`Trip ${label} is at risk of missing its pickup/appointment window.`);
    }
  }

  return ordered;
}

export function optimizeRunDetailed(trips, settings) {
  const warnings = [];
  const originalIds = trips.map(idOf);

  for (const trip of trips) pushTripWarnings(trip, warnings);

  if (trips.length <= 1) {
    return {
      orderedIds: originalIds,
      changedCount: 0,
      warnings,
    };
  }

  const final = Array(trips.length).fill(null);
  const segment = [];

  function flushSegment() {
    if (!segment.length) return;
    const optimized = optimizeUnlockedSegment(segment.map((entry) => entry.trip), settings, warnings);
    for (let i = 0; i < segment.length; i++) {
      final[segment[i].index] = idOf(optimized[i]);
    }
    segment.length = 0;
  }

  for (let i = 0; i < trips.length; i++) {
    const trip = trips[i];
    if (LOCKED_STATUSES.has(trip.status)) {
      flushSegment();
      final[i] = idOf(trip);
    } else {
      segment.push({ index: i, trip });
    }
  }
  flushSegment();

  const orderedIds = final.filter(Boolean);
  const changedCount = orderedIds.reduce((count, id, idx) => count + (id !== originalIds[idx] ? 1 : 0), 0);

  return {
    orderedIds,
    changedCount,
    warnings: [...new Set(warnings)].slice(0, 50),
  };
}

export function optimizeRun(trips, settings) {
  return optimizeRunDetailed(trips, settings).orderedIds;
}
