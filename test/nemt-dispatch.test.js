import express from 'express';
import request from 'supertest';
import NemtRunModel from '../models/NemtRunSchema.js';
import NemtTripModel from '../models/NemtTripSchema.js';
import ActiveModel from '../models/ActiveSchema.js';
import { NemtSettingsModel } from '../models/NemtSettingsSchema.js';
import * as NemtRuns from '../controllers/NemtRuns.js';

jest.mock('../models/NemtRunSchema.js', () => ({ default: { findById: jest.fn(), find: jest.fn(), updateOne: jest.fn() }, __esModule: true }));
jest.mock('../models/NemtTripSchema.js', () => ({ default: { findById: jest.fn(), find: jest.fn(), updateMany: jest.fn() }, __esModule: true }));
jest.mock('../models/ActiveSchema.js', () => ({ default: { findOne: jest.fn(), find: jest.fn() }, __esModule: true }));
jest.mock('../models/NemtSettingsSchema.js', () => ({
  NemtSettingsModel: { findById: jest.fn() },
  NEMT_SETTINGS_ID: 'nemt_settings',
}));
jest.mock('../realtime/nemtPayloads.js', () => ({
  toAdminNemtRunPayload: (run) => ({ id: 'run-id', status: run.status }),
  toDriverNemtRunPayload: () => ({ id: 'run-id' }),
  toAdminNemtTripPayload: (trip) => ({ id: 'trip-id', tripId: trip.tripId }),
}));
jest.mock('../realtime/index.js', () => ({
  emitToAdmins: jest.fn(),
  emitToDriver: jest.fn(),
}));
jest.mock('../services/nemtOptimizer.js', () => ({
  optimizeRunDetailed: (trips) => ({ orderedIds: trips.map((t) => t._id), changedCount: 0, warnings: [] }),
}));
jest.mock('../utils/saveWithRetry.js', () => ({
  saveWithIdRetry: async (fn) => fn(),
}));
// autoAssign is not called in dispatchRun but imported by NemtRuns; mock the scheduler
jest.mock('../services/nemtScheduler.js', () => ({
  autoAssignTripsToRuns: jest.fn(),
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
  app.post('/runs/:id/dispatch', NemtRuns.dispatchRun);
  return app;
}

// Returns a mock populated query chain for findById().populate()
function makePopulateChain(doc, leanDoc) {
  const lean = jest.fn().mockResolvedValue(leanDoc ?? doc);
  const populated = Promise.resolve(doc);
  populated.lean = lean;
  const populate = jest.fn().mockReturnValue(populated);
  return { populate };
}

function makeRun(overrides = {}) {
  return {
    _id: 'run-oid',
    runId: 5001,
    driverId: 'D1',
    cabNumber: 'CAB-1',
    status: 'Assigned',
    dispatchedAt: null,
    history: [],
    trips: [
      { _id: 'trip-oid', tripId: 101, mobilityType: 'ambulatory', passengerCount: 1, attendantCount: 0 },
    ],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSettings(overrides = {}) {
  return {
    requireCabBeforeDispatch: false,
    blockDispatchToOfflineDrivers: false,
    ...overrides,
  };
}

function makeActiveDriver(overrides = {}) {
  return {
    driverId: 'D1',
    status: 'Active',
    availability: 'Online',
    nemtCapabilities: { ambulatory: true, wheelchair: false },
    nemtCapacity: { ambulatorySeats: 4, wheelchairPositions: 0, maxPassengerCount: 4 },
    ...overrides,
  };
}

describe('dispatchRun — pre-conditions', () => {
  test('returns 404 when run not found', async () => {
    NemtRunModel.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });
    const res = await request(makeApp()).post('/runs/bad-id/dispatch');
    expect(res.status).toBe(404);
  });

  test('returns 409 when run is already cancelled', async () => {
    const run = makeRun({ status: 'Cancelled' });
    NemtRunModel.findById = jest.fn().mockReturnValue(makePopulateChain(run).populate ? { populate: jest.fn().mockResolvedValue(run) } : null);
    NemtRunModel.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(run) });
    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(409);
  });

  test('returns 400 when no driver assigned', async () => {
    const run = makeRun({ driverId: null });
    NemtRunModel.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(run) });
    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/driver must be assigned/i);
  });

  test('returns 400 when run has no trips', async () => {
    const run = makeRun({ trips: [] });
    NemtRunModel.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(run) });
    NemtSettingsModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(makeSettings()) });
    ActiveModel.findOne = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(makeActiveDriver()) });
    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least one trip/i);
  });
});

describe('dispatchRun — cab check', () => {
  test('returns 400 when requireCabBeforeDispatch=true and no cabNumber', async () => {
    const run = makeRun({ cabNumber: '' });
    NemtRunModel.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(run) });
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeSettings({ requireCabBeforeDispatch: true })),
    });

    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cab number/i);
  });

  test('allows dispatch when requireCabBeforeDispatch=false and no cabNumber', async () => {
    const run = makeRun({ cabNumber: '' });
    NemtRunModel.findById = jest.fn()
      .mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(run) })
      .mockReturnValue({ populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(run) }) });
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeSettings({ requireCabBeforeDispatch: false })),
    });
    ActiveModel.findOne = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(makeActiveDriver()) });
    NemtTripModel.updateMany = jest.fn().mockResolvedValue({});

    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(200);
  });
});

describe('dispatchRun — online-driver check', () => {
  test('returns 400 when blockDispatchToOfflineDrivers=true and driver is Offline', async () => {
    const run = makeRun();
    NemtRunModel.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(run) });
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeSettings({ blockDispatchToOfflineDrivers: true })),
    });
    ActiveModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeActiveDriver({ availability: 'Offline' })),
    });

    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/offline/i);
  });

  test('returns 400 when blockDispatchToOfflineDrivers=true and driver not in roster', async () => {
    const run = makeRun();
    NemtRunModel.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(run) });
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeSettings({ blockDispatchToOfflineDrivers: true })),
    });
    ActiveModel.findOne = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not found in the active roster/i);
  });

  test('allows dispatch when blockDispatchToOfflineDrivers=false even if driver is Offline', async () => {
    const run = makeRun();
    NemtRunModel.findById = jest.fn()
      .mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(run) })
      .mockReturnValue({ populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(run) }) });
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeSettings({ blockDispatchToOfflineDrivers: false })),
    });
    ActiveModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeActiveDriver({ availability: 'Offline' })),
    });
    NemtTripModel.updateMany = jest.fn().mockResolvedValue({});

    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(200);
  });
});

describe('dispatchRun — vehicle capability check', () => {
  test('returns 400 when driver vehicle cannot support a wheelchair trip', async () => {
    const run = makeRun({
      trips: [{ _id: 'trip-oid', tripId: 101, mobilityType: 'wheelchair', passengerCount: 1 }],
    });
    NemtRunModel.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(run) });
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeSettings()),
    });
    // Driver has no wheelchair capability
    ActiveModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeActiveDriver({
        nemtCapabilities: { ambulatory: true, wheelchair: false },
        nemtCapacity: { wheelchairPositions: 0, maxPassengerCount: 4 },
      })),
    });

    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/vehicle cannot support/i);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues[0]).toMatch(/wheelchair/i);
  });

  test('allows dispatch when driver vehicle supports all trip types', async () => {
    const run = makeRun({
      trips: [{ _id: 'trip-oid', tripId: 101, mobilityType: 'ambulatory', passengerCount: 1 }],
    });
    NemtRunModel.findById = jest.fn()
      .mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(run) })
      .mockReturnValue({ populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(run) }) });
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeSettings()),
    });
    ActiveModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeActiveDriver()),
    });
    NemtTripModel.updateMany = jest.fn().mockResolvedValue({});

    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(200);
  });
});

describe('dispatchRun — successful dispatch', () => {
  test('sets run status to Dispatched and marks eligible trips Dispatched', async () => {
    const run = makeRun();
    NemtRunModel.findById = jest.fn()
      .mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(run) })
      .mockReturnValue({ populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ...run, status: 'Dispatched' }) }) });
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeSettings()),
    });
    ActiveModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(makeActiveDriver()),
    });
    NemtTripModel.updateMany = jest.fn().mockResolvedValue({});

    const res = await request(makeApp()).post('/runs/run-oid/dispatch');
    expect(res.status).toBe(200);
    expect(run.status).toBe('Dispatched');
    expect(run.save).toHaveBeenCalled();
    expect(NemtTripModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run._id }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'Dispatched' }) }),
    );
  });
});
