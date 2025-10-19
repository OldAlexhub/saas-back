export function toDriverBookingPayload(bookingDoc) {
  if (!bookingDoc) return null;
  const booking =
    typeof bookingDoc.toObject === "function" ? bookingDoc.toObject({ getters: true, virtuals: false }) : bookingDoc;
  if (!booking) return null;

  return {
    id: booking._id?.toString?.() || booking._id,
    bookingId: booking.bookingId,
    pickupAddress: booking.pickupAddress,
    dropoffAddress: booking.dropoffAddress,
    pickupTime: booking.pickupTime,
    dropoffTime: booking.droppedOffAt || null,
    status: booking.status,
    passengers: booking.passengers,
    notes: booking.notes,
    driverId: booking.driverId,
    cabNumber: booking.cabNumber,
    dispatchMethod: booking.dispatchMethod,
    tripSource: booking.tripSource,
    estimatedFare: booking.estimatedFare,
    finalFare: booking.finalFare,
    pickupLat: booking.pickupLat,
    pickupLon: booking.pickupLon,
    dropoffLat: booking.dropoffLat,
    dropoffLon: booking.dropoffLon,
    appliedFees: Array.isArray(booking.appliedFees)
      ? booking.appliedFees.map((fee) => ({ name: fee?.name, amount: fee?.amount }))
      : [],
  };
}

export function toAdminBookingPayload(bookingDoc) {
  if (!bookingDoc) return null;
  const booking =
    typeof bookingDoc.toObject === "function" ? bookingDoc.toObject({ getters: true, virtuals: false }) : bookingDoc;
  if (!booking) return null;

  return {
    id: booking._id?.toString?.() || booking._id,
    bookingId: booking.bookingId,
    pickupAddress: booking.pickupAddress,
    dropoffAddress: booking.dropoffAddress,
    pickupTime: booking.pickupTime,
    status: booking.status,
    driverId: booking.driverId,
    cabNumber: booking.cabNumber,
    dispatchMethod: booking.dispatchMethod,
    tripSource: booking.tripSource,
    passengers: booking.passengers,
    estimatedFare: booking.estimatedFare,
    finalFare: booking.finalFare,
    needs_reassignment: booking.needs_reassignment,
  };
}
