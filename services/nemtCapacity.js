const DEFAULT_CAPACITY = {
  ambulatorySeats: 4,
  wheelchairPositions: 0,
  stretcherPositions: 0,
  maxPassengerCount: 4,
};

export function normalizeNemtCapabilities(source = {}) {
  const capabilities = source.nemtCapabilities || {};
  return {
    ambulatory: capabilities.ambulatory !== false,
    wheelchair: Boolean(capabilities.wheelchair),
    wheelchairXL: Boolean(capabilities.wheelchairXL),
    stretcher: Boolean(capabilities.stretcher),
  };
}

export function normalizeNemtCapacity(source = {}) {
  const raw = source.nemtCapacity || {};
  return {
    ambulatorySeats: Math.max(0, Number(raw.ambulatorySeats ?? DEFAULT_CAPACITY.ambulatorySeats) || 0),
    wheelchairPositions: Math.max(0, Number(raw.wheelchairPositions ?? DEFAULT_CAPACITY.wheelchairPositions) || 0),
    stretcherPositions: Math.max(0, Number(raw.stretcherPositions ?? DEFAULT_CAPACITY.stretcherPositions) || 0),
    maxPassengerCount: Math.max(1, Number(raw.maxPassengerCount ?? DEFAULT_CAPACITY.maxPassengerCount) || 1),
  };
}

export function getTripLoad(trip = {}) {
  return {
    people: Math.max(1, Number(trip.passengerCount ?? 1) || 1) + Math.max(0, Number(trip.attendantCount ?? 0) || 0),
    mobilityType: trip.mobilityType || "ambulatory",
  };
}

export function getCapacityIssues(vehicleLike = {}, trip = {}) {
  const caps = normalizeNemtCapabilities(vehicleLike);
  const capacity = normalizeNemtCapacity(vehicleLike);
  const load = getTripLoad(trip);
  const issues = [];

  if (load.people > capacity.maxPassengerCount) {
    issues.push(`Trip requires ${load.people} total rider/attendant seats; vehicle capacity is ${capacity.maxPassengerCount}.`);
  }

  if (load.mobilityType === "wheelchair" && (!caps.wheelchair || capacity.wheelchairPositions < 1)) {
    issues.push("Trip requires wheelchair-capable vehicle.");
  }
  if (load.mobilityType === "wheelchair_xl" && (!caps.wheelchairXL || capacity.wheelchairPositions < 1)) {
    issues.push("Trip requires wheelchair XL capable vehicle.");
  }
  if (load.mobilityType === "stretcher" && (!caps.stretcher || capacity.stretcherPositions < 1)) {
    issues.push("Trip requires stretcher-capable vehicle.");
  }

  return issues;
}

export function vehicleSupportsTrip(vehicleLike = {}, trip = {}) {
  return getCapacityIssues(vehicleLike, trip).length === 0;
}
