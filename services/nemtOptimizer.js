// Phase-1 NEMT run optimizer.
// Uses a greedy nearest-neighbor algorithm within pickup-time clusters.
// No Mapbox API calls — proximity is computed via Haversine straight-line distance.
// A Mapbox-matrix-powered optimizer can replace this in a later phase.

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

function haversineKm(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Resequence a set of NEMT trips for a single run.
 *
 * Locked trips (already in-progress or terminal) keep their current index.
 * The remaining trips are sorted by scheduledPickupTime, then within each
 * cluster window by proximity to the previous stop (nearest-neighbor).
 *
 * @param {object[]} trips - NemtTrip documents in current run order
 * @param {object|null} settings - NemtSettings document (may be null, uses defaults)
 * @returns {string[]} Ordered array of trip _id strings
 */
export function optimizeRun(trips, settings) {
  const clusterWindowMs = (settings?.clusterWindowMinutes ?? 20) * 60_000;

  // Separate locked (preserve position) from optimizable
  const lockedByOriginalIndex = new Map();
  const optimizable = [];

  for (let i = 0; i < trips.length; i++) {
    const trip = trips[i];
    if (LOCKED_STATUSES.has(trip.status)) {
      lockedByOriginalIndex.set(i, trip._id.toString());
    } else {
      optimizable.push(trip);
    }
  }

  if (optimizable.length === 0) {
    return trips.map((t) => t._id.toString());
  }

  // Sort by scheduledPickupTime (ascending) as the baseline
  optimizable.sort((a, b) => {
    const ta = a.scheduledPickupTime ? new Date(a.scheduledPickupTime).getTime() : 0;
    const tb = b.scheduledPickupTime ? new Date(b.scheduledPickupTime).getTime() : 0;
    return ta - tb;
  });

  // Greedy nearest-neighbor within each time cluster
  const result = [];
  let remaining = [...optimizable];
  let curLon = remaining[0]?.pickupLon ?? 0;
  let curLat = remaining[0]?.pickupLat ?? 0;

  while (remaining.length > 0) {
    const firstTime = remaining[0]?.scheduledPickupTime
      ? new Date(remaining[0].scheduledPickupTime).getTime()
      : 0;

    // Partition into in-window and out-of-window
    const inWindow = [];
    const outWindow = [];
    for (const t of remaining) {
      const tTime = t.scheduledPickupTime ? new Date(t.scheduledPickupTime).getTime() : 0;
      if (Math.abs(tTime - firstTime) <= clusterWindowMs) {
        inWindow.push(t);
      } else {
        outWindow.push(t);
      }
    }

    // Sort in-window cluster by distance from current position
    inWindow.sort((a, b) => {
      const distA =
        a.pickupLon != null && a.pickupLat != null
          ? haversineKm(curLon, curLat, a.pickupLon, a.pickupLat)
          : Infinity;
      const distB =
        b.pickupLon != null && b.pickupLat != null
          ? haversineKm(curLon, curLat, b.pickupLon, b.pickupLat)
          : Infinity;
      return distA - distB;
    });

    for (const t of inWindow) {
      result.push(t._id.toString());
      // Advance current position to the dropoff of the just-added trip
      curLon = t.dropoffLon ?? t.pickupLon ?? curLon;
      curLat = t.dropoffLat ?? t.pickupLat ?? curLat;
    }

    remaining = outWindow;
  }

  // Reconstruct full sequence: locked trips hold their original positions,
  // optimized trips fill the remaining slots in order.
  const final = Array(trips.length).fill(null);
  for (const [idx, id] of lockedByOriginalIndex) {
    final[idx] = id;
  }

  let resultIdx = 0;
  for (let i = 0; i < final.length; i++) {
    if (final[i] === null) {
      final[i] = result[resultIdx++];
    }
  }

  return final;
}
