import { z } from 'zod';

export const createBookingSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required.'),
  phoneNumber: z.string().min(1, 'Phone number is required.'),
  pickupAddress: z.string().min(1, 'Pickup address is required.'),
  pickupTime: z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'pickupTime must be a valid date.' }),
  dropoffAddress: z.string().optional(),
  pickupLon: z.number().optional(),
  pickupLat: z.number().optional(),
  dropoffLon: z.number().optional(),
  dropoffLat: z.number().optional(),
  passengers: z.number().int().min(1).optional(),
  estimatedFare: z.number().min(0).optional(),
  fareStrategy: z.enum(['meter', 'flat']).optional(),
  notes: z.string().optional(),
  wheelchairNeeded: z.boolean().optional(),
  dispatchMethod: z.enum(['auto', 'manual', 'flagdown']).optional(),
});

export const assignBookingSchema = z.object({
  driverId: z.string().optional(),
  cabNumber: z.string().optional(),
  dispatchMethod: z.enum(['auto', 'manual']).optional(),
});
