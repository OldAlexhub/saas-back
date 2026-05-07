import express from 'express';
import request from 'supertest';
import NemtTripModel from '../models/NemtTripSchema.js';
import NemtRunModel from '../models/NemtRunSchema.js';
import { NemtSettingsModel } from '../models/NemtSettingsSchema.js';
import * as NemtDriverApp from '../controllers/NemtDriverApp.js';

jest.mock('../models/NemtTripSchema.js');
jest.mock('../models/NemtRunSchema.js');
jest.mock('../models/NemtPaymentBatchSchema.js');
jest.mock('../models/NemtTripEventSchema.js', () => ({
  default: {
    create: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  },
  __esModule: true,
}));
jest.mock('../models/NemtSettingsSchema.js', () => ({
  NemtSettingsModel: { findById: jest.fn() },
  NEMT_SETTINGS_ID: 'nemt_settings',
}));
jest.mock('../realtime/nemtPayloads.js', () => ({
  toDriverNemtRunPayload: () => ({ id: 'run-id' }),
  toDriverNemtTripPayload: (trip) => ({ id: trip._id?.toString?.() || 'trip-id', status: trip.status }),
}));
jest.mock('../realtime/index.js', () => ({
  emitToAdmins: jest.fn(),
  emitToDriver: jest.fn(),
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  // Simulate driver auth middleware
  app.use((req, _res, next) => { req.driver = { driverId: 'D1' }; next(); });
  app.patch('/trips/:id/status', NemtDriverApp.updateNemtTripStatus);
  return app;
}

// Build a mutable Mongoose-document-like trip object
function makeTripDoc(overrides = {}) {
  const doc = {
    _id: 'trip-oid',
    tripId: 101,
    driverId: 'D1',
    runId: null,
    status: 'EnRoute',
    proofOfService: {},
    scheduledPickupTime: new Date('2026-05-06T09:00:00Z'),
    pickedUpAt: null,
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return doc;
}

describe('updateNemtTripStatus — ArrivedPickup stores pickupGps', () => {
  let tripDoc;

  beforeEach(() => {
    jest.clearAllMocks();
    tripDoc = makeTripDoc({ status: 'EnRoute' });
    NemtTripModel.findById = jest.fn().mockResolvedValue(tripDoc);
    NemtSettingsModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({}) });
  });

  test('stores pickupGps when GPS coords are provided', async () => {
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({ status: 'ArrivedPickup', gpsLon: -73.5, gpsLat: 45.5 });

    expect(res.status).toBe(200);
    expect(tripDoc.proofOfService.pickupGps).toMatchObject({ lon: -73.5, lat: 45.5 });
    expect(tripDoc.proofOfService.pickupGps.capturedAt).toBeDefined();
    expect(tripDoc.markModified).toHaveBeenCalledWith('proofOfService');
    expect(tripDoc.save).toHaveBeenCalled();
  });

  test('does not set pickupGps when GPS coords are absent', async () => {
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({ status: 'ArrivedPickup' });

    expect(res.status).toBe(200);
    expect(tripDoc.proofOfService.pickupGps).toBeUndefined();
  });

  test('returns 400 for invalid transition (EnRoute → Completed)', async () => {
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({ status: 'Completed' });

    expect(res.status).toBe(400);
  });

  test('returns 403 when trip is assigned to a different driver', async () => {
    tripDoc.driverId = 'D2';
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({ status: 'ArrivedPickup' });

    expect(res.status).toBe(403);
  });
});

describe('updateNemtTripStatus — Completed stores dropoffGps, driverNote, issueFlag', () => {
  let tripDoc;

  beforeEach(() => {
    jest.clearAllMocks();
    tripDoc = makeTripDoc({ status: 'ArrivedDrop' });
    NemtTripModel.findById = jest.fn().mockResolvedValue(tripDoc);
    NemtSettingsModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({}) });
  });

  test('stores dropoffGps, driverNote, issueFlag on Completed', async () => {
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({
        status: 'Completed',
        gpsLon: -74.0,
        gpsLat: 40.7,
        driverNote: 'Patient required assistance.',
        issueFlag: true,
        actualMiles: 12.5,
      });

    expect(res.status).toBe(200);
    expect(tripDoc.proofOfService.dropoffGps).toMatchObject({ lon: -74.0, lat: 40.7 });
    expect(tripDoc.proofOfService.driverNote).toBe('Patient required assistance.');
    expect(tripDoc.proofOfService.issueFlag).toBe(true);
    expect(tripDoc.actualMiles).toBe(12.5);
  });

  test('stores dropoffGps without driverNote when note is absent', async () => {
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({ status: 'Completed', gpsLon: -74.0, gpsLat: 40.7 });

    expect(res.status).toBe(200);
    expect(tripDoc.proofOfService.dropoffGps).toMatchObject({ lon: -74.0, lat: 40.7 });
    expect(tripDoc.proofOfService.driverNote).toBeUndefined();
  });

  test('does not store dropoffGps when coords absent', async () => {
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({ status: 'Completed' });

    expect(res.status).toBe(200);
    expect(tripDoc.proofOfService.dropoffGps).toBeUndefined();
  });

  test('returns 409 when trip is already in terminal status', async () => {
    tripDoc.status = 'Completed';
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({ status: 'Completed' });

    expect(res.status).toBe(409);
  });
});

describe('updateNemtTripStatus — NoShow stores noShowGps and driverNote', () => {
  let tripDoc;

  beforeEach(() => {
    jest.clearAllMocks();
    tripDoc = makeTripDoc({ status: 'ArrivedPickup' });
    NemtTripModel.findById = jest.fn().mockResolvedValue(tripDoc);
    NemtSettingsModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({}) });
  });

  test('stores noShowGps and driverNote on NoShow', async () => {
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({
        status: 'NoShow',
        gpsLon: -73.9,
        gpsLat: 40.8,
        driverNote: 'No answer after 5 minutes.',
        issueFlag: false,
        noShowReason: 'No answer',
      });

    expect(res.status).toBe(200);
    expect(tripDoc.proofOfService.noShowGps).toMatchObject({ lon: -73.9, lat: 40.8 });
    expect(tripDoc.proofOfService.driverNote).toBe('No answer after 5 minutes.');
    expect(tripDoc.proofOfService.issueFlag).toBe(false);
    expect(tripDoc.noShowReason).toBe('No answer');
  });

  test('does not store noShowGps when coords absent', async () => {
    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({ status: 'NoShow' });

    expect(res.status).toBe(200);
    expect(tripDoc.proofOfService.noShowGps).toBeUndefined();
  });
});

describe('updateNemtTripStatus — duplicate event idempotency', () => {
  test('returns 200 with duplicate:true when eventId already processed', async () => {
    const NemtTripEventModel = (await import('../models/NemtTripEventSchema.js')).default;
    NemtTripEventModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ eventId: 'EVT-1' }),
    });

    const tripDoc = makeTripDoc({ status: 'EnRoute' });
    // Called for the lean fetch in the duplicate path
    NemtTripModel.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(tripDoc) }),
    });

    const res = await request(makeApp())
      .patch('/trips/trip-oid/status')
      .send({ status: 'ArrivedPickup', eventId: 'EVT-1' });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
  });
});
