// NEMT payload serializers.
// toAdmin* functions include all fields (agency fare, billing, internals).
// toDriver* functions include only driver-visible fields — no agency fare, billing, or company margins.

function toPlain(doc) {
  return typeof doc?.toObject === "function" ? doc.toObject({ getters: true, virtuals: false }) : doc;
}

function idStr(v) {
  return v?.toString?.() ?? v ?? null;
}

// ---- Trip ----

export function toDriverNemtTripPayload(tripDoc) {
  if (!tripDoc) return null;
  const t = toPlain(tripDoc);
  if (!t) return null;
  return {
    id: idStr(t._id),
    tripId: t.tripId,
    agencyTripRef: t.agencyTripRef,
    serviceDate: t.serviceDate,
    passengerName: t.passengerName,
    passengerPhone: t.passengerPhone,
    mobilityType: t.mobilityType,
    passengerCount: t.passengerCount,
    attendantCount: t.attendantCount,
    specialInstructions: t.specialInstructions,
    pickupAddress: t.pickupAddress,
    pickupLat: t.pickupLat,
    pickupLon: t.pickupLon,
    scheduledPickupTime: t.scheduledPickupTime,
    pickupWindowEarliest: t.pickupWindowEarliest,
    pickupWindowLatest: t.pickupWindowLatest,
    dropoffAddress: t.dropoffAddress,
    dropoffLat: t.dropoffLat,
    dropoffLon: t.dropoffLon,
    appointmentTime: t.appointmentTime,
    tripDirection: t.tripDirection,
    status: t.status,
    runId: idStr(t.runId),
    runSequence: t.runSequence,
    enRouteAt: t.enRouteAt,
    arrivedPickupAt: t.arrivedPickupAt,
    pickedUpAt: t.pickedUpAt,
    arrivedDropAt: t.arrivedDropAt,
    completedAt: t.completedAt,
    cancelledAt: t.cancelledAt,
    noShowAt: t.noShowAt,
    cancelReason: t.cancelReason,
    noShowReason: t.noShowReason,
    // Driver-facing pay only — no agency fare, no company cut
    driverPay: t.driverPay,
    payStatus: t.payStatus,
    paidAt: t.paidAt,
    payReference: t.payReference,
    payHoldReason: t.payStatus === "held" ? t.payHoldReason : undefined,
    payDisputeReason: t.payStatus === "disputed" ? t.payDisputeReason : undefined,
    otpStatus: t.otpStatus,
  };
}

export function toAdminNemtTripPayload(tripDoc) {
  if (!tripDoc) return null;
  const t = toPlain(tripDoc);
  if (!t) return null;
  return {
    id: idStr(t._id),
    tripId: t.tripId,
    agencyId: idStr(t.agencyId),
    agencyTripRef: t.agencyTripRef,
    importBatchId: t.importBatchId,
    serviceDate: t.serviceDate,
    passengerName: t.passengerName,
    passengerPhone: t.passengerPhone,
    passengerId: t.passengerId,
    passengerDob: t.passengerDob,
    mobilityType: t.mobilityType,
    passengerCount: t.passengerCount,
    attendantCount: t.attendantCount,
    specialInstructions: t.specialInstructions,
    internalNotes: t.internalNotes,
    pickupAddress: t.pickupAddress,
    pickupLat: t.pickupLat,
    pickupLon: t.pickupLon,
    scheduledPickupTime: t.scheduledPickupTime,
    pickupWindowEarliest: t.pickupWindowEarliest,
    pickupWindowLatest: t.pickupWindowLatest,
    dropoffAddress: t.dropoffAddress,
    dropoffLat: t.dropoffLat,
    dropoffLon: t.dropoffLon,
    appointmentTime: t.appointmentTime,
    tripDirection: t.tripDirection,
    linkedTripId: idStr(t.linkedTripId),
    status: t.status,
    runId: idStr(t.runId),
    runSequence: t.runSequence,
    assignedAt: t.assignedAt,
    dispatchedAt: t.dispatchedAt,
    driverId: t.driverId,
    cabNumber: t.cabNumber,
    enRouteAt: t.enRouteAt,
    arrivedPickupAt: t.arrivedPickupAt,
    pickedUpAt: t.pickedUpAt,
    arrivedDropAt: t.arrivedDropAt,
    completedAt: t.completedAt,
    cancelledAt: t.cancelledAt,
    noShowAt: t.noShowAt,
    cancelledBy: t.cancelledBy,
    cancelReason: t.cancelReason,
    noShowReason: t.noShowReason,
    // Admin-only financials
    agencyFare: t.agencyFare,
    agencyFareBasis: t.agencyFareBasis,
    estimatedMiles: t.estimatedMiles,
    actualMiles: t.actualMiles,
    billingStatus: t.billingStatus,
    billingBatchId: idStr(t.billingBatchId),
    billedAt: t.billedAt,
    billingPaidAt: t.billingPaidAt,
    billingReference: t.billingReference,
    // Driver pay
    driverPay: t.driverPay,
    driverPayBasis: t.driverPayBasis,
    payStatus: t.payStatus,
    payBatchId: idStr(t.payBatchId),
    paidAt: t.paidAt,
    payReference: t.payReference,
    payHoldReason: t.payHoldReason,
    payDisputeReason: t.payDisputeReason,
    // OTP
    otpStatus: t.otpStatus,
    scheduledVsActualMinutes: t.scheduledVsActualMinutes,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// ---- Run ----

function serializeTrips(trips, forDriver) {
  if (!Array.isArray(trips)) return [];
  return trips.map((t) => {
    if (t && typeof t === "object" && t._id) {
      return forDriver ? toDriverNemtTripPayload(t) : toAdminNemtTripPayload(t);
    }
    return idStr(t);
  });
}

export function toAdminNemtRunPayload(runDoc, { populatedTrips = false } = {}) {
  if (!runDoc) return null;
  const r = toPlain(runDoc);
  if (!r) return null;
  return {
    id: idStr(r._id),
    runId: r.runId,
    serviceDate: r.serviceDate,
    label: r.label,
    driverId: r.driverId,
    cabNumber: r.cabNumber,
    status: r.status,
    trips: populatedTrips ? serializeTrips(r.trips, false) : (r.trips || []).map(idStr),
    tripCount: r.tripCount,
    completedCount: r.completedCount,
    cancelledCount: r.cancelledCount,
    noShowCount: r.noShowCount,
    dispatchedAt: r.dispatchedAt,
    acknowledgedAt: r.acknowledgedAt,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    optimizationVersion: r.optimizationVersion,
    optimizedAt: r.optimizedAt,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toDriverNemtRunPayload(runDoc, { populatedTrips = false } = {}) {
  if (!runDoc) return null;
  const r = toPlain(runDoc);
  if (!r) return null;
  return {
    id: idStr(r._id),
    runId: r.runId,
    serviceDate: r.serviceDate,
    label: r.label,
    driverId: r.driverId,
    cabNumber: r.cabNumber,
    status: r.status,
    trips: populatedTrips ? serializeTrips(r.trips, true) : (r.trips || []).map(idStr),
    tripCount: r.tripCount,
    completedCount: r.completedCount,
    cancelledCount: r.cancelledCount,
    noShowCount: r.noShowCount,
    dispatchedAt: r.dispatchedAt,
    acknowledgedAt: r.acknowledgedAt,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    notes: r.notes,
  };
}
