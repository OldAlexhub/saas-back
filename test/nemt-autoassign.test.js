import ActiveModel from '../models/ActiveSchema.js';
import NemtRunModel from '../models/NemtRunSchema.js';
import NemtTripModel from '../models/NemtTripSchema.js';
import { NemtSettingsModel } from '../models/NemtSettingsSchema.js';
import { autoAssignTripsToRuns } from '../services/nemtScheduler.js';

jest.mock('../models/ActiveSchema.js', () => ({ default: { find: jest.fn() }, __esModule: true }));
jest.mock('../models/NemtRunSchema.js', () => ({ default: { find: jest.fn(), findById: jest.fn() }, __esModule: true }));
jest.mock('../models/NemtTripSchema.js', () => ({ default: { find: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() }, __esModule: true }));
jest.mock('../models/NemtSettingsSchema.js', () => ({
  NemtSettingsModel: { findById: jest.fn() },
  NEMT_SETTINGS_ID: 'nemt_settings',
}));
jest.mock('../services/nemtOptimizer.js', () => ({
  optimizeRunDetailed: (trips) => ({
    orderedIds: trips.map((t) => t._id),
    changedCount: 0,
    warnings: [],
  }),
}));
jest.mock('../utils/saveWithRetry.js', () => ({
  saveWithIdRetry: async (fn) => fn(),
}));

// Returns a mock query chain supporting .sort(), .populate(), .lean()
function mockFindChain(result) {
  const chain = { sort: jest.fn(), lean: jest.fn(), populate: jest.fn() };
  chain.sort.mockReturnValue(chain);
  chain.populate.mockReturnValue(chain);
  chain.lean.mockResolvedValue(result);
  return chain;
}

const SERVICE_DATE = '2026-05-06';

const DEFAULT_SETTINGS = {
  onlineDriversOnly: true,
  defaultMaxTripsPerRun: 12,
  avgMphForOptimization: 25,
};

function makeDriver(overrides = {}) {
  return {
    driverId: 'D1',
    status: 'Active',
    availability: 'Online',
    cabNumber: 'CAB-1',
    ...overrides,
  };
}

function makeTrip(overrides = {}) {
  return {
    _id: 'trip-oid-1',
    tripId: 101,
    status: 'Scheduled',
    scheduledPickupTime: new Date('2026-05-06T09:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  NemtTripModel.updateOne = jest.fn().mockResolvedValue({});
  NemtRunModel.findById = jest.fn().mockResolvedValue(null);
});

describe('autoAssignTripsToRuns — online-only filter', () => {
  beforeEach(() => {
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...DEFAULT_SETTINGS }),
    });
    NemtRunModel.find = jest.fn().mockReturnValue(mockFindChain([]));
  });

  test('passes availability:Online filter when onlineDriversOnly=true', async () => {
    ActiveModel.find = jest.fn().mockReturnValue(mockFindChain([makeDriver()]));
    NemtTripModel.find = jest.fn().mockReturnValue(mockFindChain([]));

    await autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false });

    const filter = ActiveModel.find.mock.calls[0][0];
    expect(filter.availability).toBe('Online');
    expect(filter.status).toBe('Active');
  });

  test('omits availability filter when onlineDriversOnly=false', async () => {
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, onlineDriversOnly: false }),
    });
    ActiveModel.find = jest.fn().mockReturnValue(mockFindChain([makeDriver({ availability: 'Offline' })]));
    NemtTripModel.find = jest.fn().mockReturnValue(mockFindChain([]));

    await autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false });

    const filter = ActiveModel.find.mock.calls[0][0];
    expect(filter.availability).toBeUndefined();
    expect(filter.status).toBe('Active');
  });

  test('throws 409 with "online and active" when onlineDriversOnly=true and no drivers found', async () => {
    ActiveModel.find = jest.fn().mockReturnValue(mockFindChain([]));
    NemtTripModel.find = jest.fn().mockReturnValue(mockFindChain([makeTrip()]));

    await expect(
      autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('online and active'),
      statusCode: 409,
    });
  });

  test('throws 409 with "active" (not "online") when onlineDriversOnly=false and no drivers', async () => {
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, onlineDriversOnly: false }),
    });
    ActiveModel.find = jest.fn().mockReturnValue(mockFindChain([]));
    NemtTripModel.find = jest.fn().mockReturnValue(mockFindChain([makeTrip()]));

    await expect(
      autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^No active drivers/),
      statusCode: 409,
    });
  });
});

describe('autoAssignTripsToRuns — max trips per run', () => {
  beforeEach(() => {
    NemtRunModel.find = jest.fn().mockReturnValue(mockFindChain([]));
  });

  test('uses defaultMaxTripsPerRun from settings and creates overflow run', async () => {
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, defaultMaxTripsPerRun: 2 }),
    });
    ActiveModel.find = jest.fn().mockReturnValue(mockFindChain([makeDriver()]));
    NemtTripModel.find = jest.fn().mockReturnValue(
      mockFindChain([
        makeTrip({ _id: 't1', tripId: 1 }),
        makeTrip({ _id: 't2', tripId: 2 }),
        makeTrip({ _id: 't3', tripId: 3 }),
      ]),
    );

    const result = await autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false });

    expect(result.tripCount).toBe(3);
    // 3 trips with max 2 per run → 2 buckets (one with 2, one with 1)
    expect(result.runs.length).toBe(2);
    const tripCounts = result.runs.map((r) => r.tripIds.length);
    expect(tripCounts).toContain(2);
    expect(tripCounts).toContain(1);
  });

  test('maxTripsPerRun arg overrides settings default', async () => {
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, defaultMaxTripsPerRun: 10 }),
    });
    ActiveModel.find = jest.fn().mockReturnValue(mockFindChain([makeDriver()]));
    NemtTripModel.find = jest.fn().mockReturnValue(
      mockFindChain([makeTrip({ _id: 't1' }), makeTrip({ _id: 't2' })]),
    );

    // Override to 1 trip per run → 2 trips → 2 runs
    const result = await autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, maxTripsPerRun: 1, commit: false });

    expect(result.runs.length).toBe(2);
  });
});

describe('autoAssignTripsToRuns — timing warnings', () => {
  beforeEach(() => {
    NemtRunModel.find = jest.fn().mockReturnValue(mockFindChain([]));
  });

  test('adds warning when trip is estimated to miss its pickup window', async () => {
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, avgMphForOptimization: 25 }),
    });
    // Driver with known position
    ActiveModel.find = jest.fn().mockReturnValue(
      mockFindChain([makeDriver({ currentLocation: { coordinates: [0, 0] } })]),
    );
    // Trip far from driver, pickup window already passed
    NemtTripModel.find = jest.fn().mockReturnValue(
      mockFindChain([
        makeTrip({
          _id: 't1',
          tripId: 101,
          pickupLon: 5,
          pickupLat: 0,
          pickupWindowLatest: new Date(Date.now() - 60_000).toISOString(),
        }),
      ]),
    );

    const result = await autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false });

    expect(result.warnings.some((w) => w.includes('may miss its pickup window'))).toBe(true);
  });

  test('no timing warning when trip is well within its pickup window', async () => {
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, avgMphForOptimization: 60 }),
    });
    ActiveModel.find = jest.fn().mockReturnValue(
      mockFindChain([makeDriver({ currentLocation: { coordinates: [0, 0] } })]),
    );
    // Trip nearby, window 1 hour from now
    NemtTripModel.find = jest.fn().mockReturnValue(
      mockFindChain([
        makeTrip({
          _id: 't1',
          pickupLon: 0.001,
          pickupLat: 0,
          pickupWindowLatest: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      ]),
    );

    const result = await autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false });

    expect(result.warnings.some((w) => w.includes('may miss its pickup window'))).toBe(false);
  });
});

describe('autoAssignTripsToRuns — vehicle capability warnings', () => {
  beforeEach(() => {
    NemtRunModel.find = jest.fn().mockReturnValue(mockFindChain([]));
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
    });
  });

  test('warns when no driver supports a wheelchair trip', async () => {
    // Driver explicitly has no wheelchair capability
    ActiveModel.find = jest.fn().mockReturnValue(
      mockFindChain([makeDriver({ nemtCapabilities: { ambulatory: true, wheelchair: false } })]),
    );
    NemtTripModel.find = jest.fn().mockReturnValue(
      mockFindChain([makeTrip({ _id: 't1', mobilityType: 'wheelchair' })]),
    );

    const result = await autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false });

    expect(result.warnings.some((w) => w.includes('has no available fully compatible vehicle'))).toBe(true);
  });

  test('no capability warning when driver supports the trip mobility type', async () => {
    ActiveModel.find = jest.fn().mockReturnValue(
      mockFindChain([
        makeDriver({
          nemtCapabilities: { ambulatory: true, wheelchair: true },
          nemtCapacity: { wheelchairPositions: 1, maxPassengerCount: 4 },
        }),
      ]),
    );
    NemtTripModel.find = jest.fn().mockReturnValue(
      mockFindChain([makeTrip({ _id: 't1', mobilityType: 'wheelchair' })]),
    );

    const result = await autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false });

    expect(result.warnings.some((w) => w.includes('fully compatible vehicle'))).toBe(false);
  });
});

describe('autoAssignTripsToRuns — commit=false returns plan without DB writes', () => {
  test('returns committed:false and does not call updateOne', async () => {
    NemtSettingsModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
    });
    ActiveModel.find = jest.fn().mockReturnValue(mockFindChain([makeDriver()]));
    NemtTripModel.find = jest.fn().mockReturnValue(mockFindChain([makeTrip()]));
    NemtRunModel.find = jest.fn().mockReturnValue(mockFindChain([]));

    const result = await autoAssignTripsToRuns({ serviceDate: SERVICE_DATE, commit: false });

    expect(result.committed).toBe(false);
    expect(result.tripCount).toBe(1);
    expect(result.runCount).toBe(1);
    expect(NemtTripModel.updateOne).not.toHaveBeenCalled();
  });
});
