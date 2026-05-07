import { z } from "zod";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Must be a valid date string." });

// ---- Agency ----

export const createAgencySchema = z.object({
  name: z.string().min(1, "Agency name is required."),
  contactName: z.string().optional(),
  contactEmail: z.string().email("Invalid email.").optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
  billingEmail: z.string().email("Invalid billing email.").optional().or(z.literal("")),
  notes: z.string().optional(),
});

export const updateAgencySchema = createAgencySchema.partial().extend({
  status: z.enum(["active", "inactive"]).optional(),
});

// ---- Trip ----

export const createTripSchema = z.object({
  agencyId: z.string().min(1, "agencyId is required."),
  agencyTripRef: z.string().optional(),
  serviceDate: dateString,
  passengerName: z.string().min(1, "Passenger name is required."),
  passengerPhone: z.string().optional(),
  passengerId: z.string().optional(),
  passengerDob: dateString.optional(),
  mobilityType: z.enum(["ambulatory", "wheelchair", "wheelchair_xl", "stretcher", "other"]).optional(),
  passengerCount: z.number().int().min(1).optional(),
  attendantCount: z.number().int().min(0).optional(),
  specialInstructions: z.string().optional(),
  internalNotes: z.string().optional(),
  pickupAddress: z.string().min(1, "Pickup address is required."),
  pickupLon: z.number().optional(),
  pickupLat: z.number().optional(),
  scheduledPickupTime: dateString,
  pickupWindowEarliest: dateString.optional(),
  pickupWindowLatest: dateString.optional(),
  dropoffAddress: z.string().min(1, "Dropoff address is required."),
  dropoffLon: z.number().optional(),
  dropoffLat: z.number().optional(),
  appointmentTime: dateString.optional(),
  tripDirection: z.enum(["outbound", "return"]).optional(),
  linkedTripId: z.string().optional(),
  agencyFare: z.number().min(0).optional(),
  agencyFareBasis: z.enum(["per_trip", "per_mile", "flat"]).optional(),
  estimatedMiles: z.number().min(0).optional(),
  driverPay: z.number().min(0).optional(),
  driverPayBasis: z.enum(["per_trip", "per_mile", "flat"]).optional(),
});

export const updateTripSchema = createTripSchema
  .partial()
  .omit({ agencyId: true, serviceDate: true });

export const cancelTripSchema = z.object({
  cancelledBy: z.enum(["dispatch", "passenger", "agency"]),
  cancelReason: z.string().optional(),
});

export const noShowTripSchema = z.object({
  noShowReason: z.string().optional(),
});

export const bulkCreateTripsSchema = z.object({
  trips: z
    .array(createTripSchema)
    .min(1, "At least one trip is required.")
    .max(200, "Maximum 200 trips per bulk request."),
});

// ---- Run ----

export const createRunSchema = z.object({
  serviceDate: dateString,
  label: z.string().optional(),
  driverId: z.string().optional(),
  cabNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const autoAssignRunsSchema = z.object({
  serviceDate: dateString,
  driverIds: z.array(z.string()).optional(),
  maxTripsPerRun: z.number().int().min(1).max(40).optional(),
  commit: z.boolean().optional(),
});

export const updateRunSchema = z.object({
  label: z.string().optional(),
  driverId: z.string().optional(),
  cabNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const reorderRunSchema = z.object({
  tripIds: z.array(z.string()).min(1, "tripIds must not be empty."),
});

export const addTripToRunSchema = z.object({
  tripId: z.string().min(1, "tripId is required."),
  position: z.number().int().min(0).optional(),
});

export const cancelRunSchema = z.object({
  cancelReason: z.string().optional(),
});

// ---- Settings ----

export const updateNemtSettingsSchema = z.object({
  otpOnTimeMaxMinutes: z.number().int().min(0).optional(),
  otpLateMaxMinutes: z.number().int().min(0).optional(),
  defaultPickupWindowMinutesBefore: z.number().int().min(0).optional(),
  defaultPickupWindowMinutesAfter: z.number().int().min(0).optional(),
  appointmentBufferMinutes: z.number().int().min(0).optional(),
  maxDeviationMiles: z.number().min(0).optional(),
  clusterWindowMinutes: z.number().int().min(0).optional(),
  requireDriverAcknowledgement: z.boolean().optional(),
  manifestCutoffMinutes: z.number().int().min(0).optional(),
  allowReoptimizeAfterDispatch: z.boolean().optional(),
  defaultPayBasis: z.enum(["per_trip", "per_mile", "percentage"]).optional(),
  defaultPayRatePerTrip: z.number().min(0).optional(),
  defaultPayRatePerMile: z.number().min(0).optional(),
  defaultPayPercentage: z.number().min(0).max(100).optional(),
  showDriverFinance: z.boolean().optional(),
});

// ---- Pay / Billing Batches ----

export const createBillingBatchSchema = z.object({
  agencyId: z.string().min(1, "agencyId is required."),
  tripIds: z.array(z.string()).min(1, "At least one trip is required."),
  notes: z.string().optional(),
  referenceNumber: z.string().optional(),
});

export const updateBillingBatchSchema = z.object({
  status: z.enum(["draft", "sent", "paid", "disputed", "cancelled"]).optional(),
  paidAt: dateString.optional(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const createPayBatchSchema = z.object({
  driverId: z.string().min(1, "driverId is required."),
  tripIds: z.array(z.string()).min(1, "At least one trip is required."),
  notes: z.string().optional(),
  referenceNumber: z.string().optional(),
});

export const updatePayBatchSchema = z.object({
  status: z.enum(["draft", "sent", "paid", "disputed", "cancelled"]).optional(),
  paidAt: dateString.optional(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

// ---- Driver App ----

export const driverTripStatusSchema = z.object({
  status: z.enum(["EnRoute", "ArrivedPickup", "PickedUp", "ArrivedDrop", "Completed", "NoShow", "PassengerCancelled"]),
  actualMiles: z.number().min(0).optional(),
  noShowReason: z.string().optional(),
  passengerCancelReason: z.string().optional(),
  eventId: z.string().optional(),
  capturedAt: dateString.optional(),
});

export const reportIssueSchema = z.object({
  category: z.enum(["accident", "vehicle_issue", "passenger_behavior", "route_issue", "other"]),
  description: z.string().min(1, "Description is required."),
});
