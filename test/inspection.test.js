import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import config from '../config/index.js';
import * as VehiclesCtrl from '../controllers/Vehicles.js';
import VehicleModel from '../models/VehicleSchema.js';

// Simple integration-style test for the inspection download endpoint

describe('Inspection file download', () => {
  const app = express();
  app.get('/test/vehicles/:id/inspection', async (req, res, next) => {
    // Attach a fake user to emulate authenticated admin
    req.user = { id: 'test-admin', role: 'admin' };
    return VehiclesCtrl.downloadInspectionFile(req, res, next);
  });

  const filename = `test-inspection-${Date.now()}.txt`;
  const filePath = path.join(config.uploads.vehiclesDir, filename);
  const vehicleId = '000000000000000000000001';

  beforeAll(async () => {
    // ensure uploads dir exists
    await fs.mkdir(config.uploads.vehiclesDir, { recursive: true });
    // write a small file to the uploads dir
    await fs.writeFile(filePath, 'inspection-ok');

    // mock VehicleModel.findById to return a vehicle record
    jest.spyOn(VehicleModel, 'findById').mockImplementation(async (id) => {
      if (String(id) === vehicleId) {
        return {
          _id: vehicleId,
          annualInspectionFile: {
            filename,
            originalName: 'inspection.txt',
            mimeType: 'text/plain',
            size: 12,
          },
        };
      }
      return null;
    });
  });

  afterAll(async () => {
    // cleanup file
    try { await fs.unlink(filePath); } catch (e) {}
    // restore mocks
    jest.restoreAllMocks();
  });

  test('returns 200 and serves the file', async () => {
    const res = await request(app).get(`/test/vehicles/${vehicleId}/inspection`);
    expect(res.status).toBe(200);
    expect(res.header['content-disposition']).toMatch(/attachment/);
    expect(res.text).toBe('inspection-ok');
  });
});
