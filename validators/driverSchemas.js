import { z } from 'zod';

const dateString = z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'Must be a valid date.' });

export const createDriverSchema = z.object({
  firstName: z.string().min(1, 'First name is required.'),
  lastName: z.string().min(1, 'Last name is required.'),
  dlNumber: z.string().min(1, 'License number is required.'),
  email: z.string().email('Must be a valid email address.'),
  dob: dateString,
  dlExpiry: dateString,
  dotExpiry: dateString,
  fullAddress: z.string().min(1, 'Address is required.'),
  ssn: z.string().min(4, 'SSN is required.'),
  phoneNumber: z.string().min(1, 'Phone number is required.'),
  cbiExpiry: dateString,
  mvrExpiry: dateString,
  fingerPrintsExpiry: dateString,
});

export const driverLoginSchema = z.object({
  identifier: z.string().optional(),
  email: z.string().email('Must be a valid email.').optional(),
  driverId: z.string().optional(),
  phoneNumber: z.string().optional(),
  password: z.string().min(1, 'Password is required.'),
  deviceId: z.string().nullable().optional(),
  pushToken: z.string().nullable().optional(),
}).refine((d) => d.identifier || d.email || d.driverId || d.phoneNumber, {
  message: 'identifier, email, driverId or phoneNumber is required.',
});
