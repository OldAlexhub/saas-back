import express from 'express';
import request from 'supertest';
import NemtImportBatchModel from '../models/NemtImportBatchSchema.js';
import NemtTripModel from '../models/NemtTripSchema.js';
import NemtAgencyModel from '../models/NemtAgencySchema.js';
import { NemtSettingsModel } from '../models/NemtSettingsSchema.js';
import * as NemtImports from '../controllers/NemtImports.js';

// Mock external deps so tests run without Mongo or Mapbox
jest.mock('../models/NemtImportBatchSchema.js');
jest.mock('../models/NemtTripSchema.js');
jest.mock('../models/NemtAgencySchema.js');
jest.mock('../models/NemtSettingsSchema.js');
jest.mock('../realtime/nemtPayloads.js', () => ({
  toAdminNemtTripPayload: (trip) => ({ id: 'trip-id', tripId: trip.tripId }),
}));
jest.mock('../realtime/index.js', () => ({ emitToAdmins: jest.fn() }));
jest.mock('../services/nemtImport.js', () => ({
  parseImportFile: () => ({
    rows: [
      {
        passengerName: 'Jane Doe',
        pickupAddress: '100 Main St',
        dropoffAddress: '200 Oak Ave',
        scheduledPickupTime: '09:00',
        agencyTripRef: 'REF-001',
      },
      {
        passengerName: '',
        pickupAddress: '',
        dropoffAddress: '300 Pine Rd',
        scheduledPickupTime: '10:00',
      },
    ],
    errors: [null, null],
  }),
}));
jest.mock('../utils/mapbox.js', () => ({ geocodeAddress: async () => null }));
jest.mock('../utils/saveWithRetry.js', () => ({
  saveWithIdRetry: async (fn) => fn(),
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
  app.post('/imports/stage', (req, res) => {
    req.file = {
      buffer: Buffer.from('fake'),
      mimetype: 'text/csv',
      originalname: 'trips.csv',
    };
    req.body = { agencyId: 'AGENCY-1', serviceDate: '2026-05-06' };
    return NemtImports.stageImport(req, res);
  });
  app.get('/imports/:id', NemtImports.getImportBatch);
  app.post('/imports/:id/commit', NemtImports.commitImportBatch);
  app.patch('/imports/:id/rows/:rowNumber', NemtImports.correctImportRow);
  app.post('/imports/:id/cancel', NemtImports.cancelImportBatch);
  app.post('/imports/:id/rollback', NemtImports.rollbackImportBatch);
  return app;
}

function makeStagedBatch(overrides = {}) {
  return {
    _id: 'batch-oid',
    batchId: 'NEMT-IMPORT-123-ABCD',
    agencyId: 'AGENCY-1',
    serviceDate: new Date('2026-05-06'),
    status: 'staged',
    totalRows: 2,
    validRows: 1,
    warningRows: 0,
    errorRows: 1,
    importedRows: 0,
    skippedRows: 0,
    rows: [
      {
        rowNumber: 2,
        status: 'valid',
        data: {
          passengerName: 'Jane Doe',
          pickupAddress: '100 Main St',
          dropoffAddress: '200 Oak Ave',
          agencyId: 'AGENCY-1',
          serviceDate: new Date('2026-05-06'),
          scheduledPickupTime: new Date('2026-05-06T09:00:00Z'),
          agencyTripRef: 'REF-001',
        },
        errors: [],
        warnings: [],
      },
      {
        rowNumber: 3,
        status: 'error',
        data: {},
        errors: ['Missing passenger name.', 'Missing pickup address.'],
        warnings: [],
      },
    ],
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    toObject: function () { return { ...this, rows: this.rows }; },
    ...overrides,
  };
}

describe('NEMT Import — stageImport', () => {
  beforeEach(() => {
    NemtAgencyModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ agencyId: 'AGENCY-1', name: 'Test' }),
    });
    NemtSettingsModel.findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        defaultPickupWindowMinutesBefore: 15,
        defaultPickupWindowMinutesAfter: 30,
        defaultPayBasis: 'per_trip',
      }),
    });
    NemtTripModel.findOne = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    }); // no duplicates
    NemtImportBatchModel.mockImplementation(() => ({
      batchId: 'NEMT-IMPORT-1',
      agencyId: 'AGENCY-1',
      serviceDate: new Date('2026-05-06'),
      status: 'staged',
      totalRows: 2,
      validRows: 1,
      warningRows: 0,
      errorRows: 1,
      importedRows: 0,
      skippedRows: 0,
      rows: [],
      save: jest.fn().mockResolvedValue(undefined),
      _id: { toString: () => 'new-batch-id' },
    }));
  });

  test('creates staged batch from parsed CSV', async () => {
    const app = makeApp();
    const res = await request(app).post('/imports/stage');
    expect(res.status).toBe(201);
    expect(res.body.batch).toBeDefined();
  });
});

describe('NEMT Import — commitImportBatch', () => {
  let app;
  let batch;

  beforeEach(() => {
    NemtSettingsModel.findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ defaultPickupWindowMinutesBefore: 15 }),
    });
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
    app.post('/imports/:id/commit', NemtImports.commitImportBatch);

    batch = makeStagedBatch();
    NemtImportBatchModel.findById = jest.fn().mockResolvedValue(batch);

    const savedTrip = { _id: 'trip-oid', tripId: 12345, save: jest.fn().mockResolvedValue(undefined) };
    NemtTripModel.mockImplementation(() => savedTrip);
  });

  test('commits valid rows and skips error rows', async () => {
    const res = await request(app).post('/imports/batch-oid/commit').send({});
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    const importedRow = batch.rows.find((r) => r.rowNumber === 2);
    expect(importedRow.status).toBe('imported');
    const errorRow = batch.rows.find((r) => r.rowNumber === 3);
    expect(errorRow.status).toBe('skipped');
  });

  test('skips warning rows when allowWarnings is false (default)', async () => {
    batch.rows[0].status = 'warning';
    const res = await request(app).post('/imports/batch-oid/commit').send({});
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(0);
    expect(batch.rows[0].status).toBe('skipped');
  });

  test('commits warning rows when allowWarnings=true', async () => {
    batch.rows[0].status = 'warning';
    const res = await request(app).post('/imports/batch-oid/commit').send({ allowWarnings: true });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    expect(batch.rows[0].status).toBe('imported');
  });

  test('returns 409 if batch is already committed', async () => {
    batch.status = 'committed';
    const res = await request(app).post('/imports/batch-oid/commit').send({});
    expect(res.status).toBe(409);
  });
});

describe('NEMT Import — cancelImportBatch', () => {
  let app;
  let batch;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
    app.post('/imports/:id/cancel', NemtImports.cancelImportBatch);

    batch = makeStagedBatch();
    NemtImportBatchModel.findById = jest.fn().mockResolvedValue(batch);
  });

  test('cancels a staged batch', async () => {
    const res = await request(app).post('/imports/batch-oid/cancel').send({});
    expect(res.status).toBe(200);
    expect(batch.status).toBe('cancelled');
  });

  test('returns 409 if batch is already committed', async () => {
    batch.status = 'committed';
    const res = await request(app).post('/imports/batch-oid/cancel').send({});
    expect(res.status).toBe(409);
  });
});

describe('NEMT Import — rollbackImportBatch', () => {
  let app;
  let batch;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
    app.post('/imports/:id/rollback', NemtImports.rollbackImportBatch);

    batch = {
      ...makeStagedBatch({ status: 'committed' }),
      rows: [
        {
          rowNumber: 2,
          status: 'imported',
          data: {},
          errors: [],
          warnings: [],
          createdTripId: 'trip-oid-1',
        },
      ],
    };
    NemtImportBatchModel.findById = jest.fn().mockResolvedValue(batch);
    NemtTripModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    }); // no started trips
    NemtTripModel.deleteMany = jest.fn().mockResolvedValue({});
  });

  test('rolls back committed batch and deletes trips', async () => {
    const res = await request(app).post('/imports/batch-oid/rollback').send({});
    expect(res.status).toBe(200);
    expect(NemtTripModel.deleteMany).toHaveBeenCalled();
    expect(batch.status).toBe('cancelled');
    expect(res.body.deletedTripCount).toBe(1);
  });

  test('blocks rollback if any trip has started', async () => {
    NemtTripModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ tripId: 12345, status: 'EnRoute' }]),
      }),
    });
    const res = await request(app).post('/imports/batch-oid/rollback').send({});
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/started/);
  });

  test('returns 409 for staged batches', async () => {
    batch.status = 'staged';
    const res = await request(app).post('/imports/batch-oid/rollback').send({});
    expect(res.status).toBe(409);
  });
});

describe('NEMT Import — duplicate prevention', () => {
  test('stageImport marks row as error when agencyTripRef already exists in DB', async () => {
    NemtAgencyModel.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ agencyId: 'AGENCY-1' }),
    });
    NemtSettingsModel.findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        defaultPickupWindowMinutesBefore: 15,
        defaultPickupWindowMinutesAfter: 30,
      }),
    });
    NemtTripModel.findOne = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ tripId: 99999 }) }),
    }); // duplicate

    let savedRows;
    NemtImportBatchModel.mockImplementation((doc) => {
      savedRows = doc.rows;
      return {
        batchId: 'X',
        agencyId: doc.agencyId,
        serviceDate: doc.serviceDate,
        status: 'staged',
        totalRows: 2,
        validRows: 0,
        warningRows: 0,
        errorRows: 1,
        importedRows: 0,
        skippedRows: 0,
        rows: doc.rows,
        save: jest.fn().mockResolvedValue(undefined),
        _id: { toString: () => 'batch-2' },
      };
    });

    const app = makeApp();
    await request(app).post('/imports/stage');
    // The valid row (REF-001) should become error because it's a duplicate
    const ref001Row = savedRows.find((r) => r.data?.agencyTripRef === 'REF-001');
    expect(ref001Row?.status).toBe('error');
    expect(ref001Row?.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });
});
