
// This test assumes a local test MongoDB is available via MONGO_URL and
// that the server exports the app. If server.js does not export, this test
// will need to import the app differently. The project uses nodemon and
// boots the server on import; for CI we'd refactor server.js to export the
// app. For now this file is a starting point and may require small tweaks.

import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app.js';

describe('inspection upload/download (GridFS)', () => {
  beforeAll(async () => {
    if (!process.env.MONGO_URL) throw new Error('MONGO_URL must be set for tests');
    process.env.DISABLE_AUTH = 'true';
    await mongoose.connect(process.env.MONGO_URL);
  }, 20000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  test('upload a vehicle file and download it', async () => {
    // Create vehicle with multipart upload
    const smallBuffer = Buffer.from('hello-gridfs-test');
    const res = await request(app)
      .post('/api/vehicles')
      .field('cabNumber', 'TEST123')
      .field('vinNumber', 'VIN123')
      .field('licPlates', 'LP123')
      .field('regisExpiry', '2030-01-01')
      .field('year', '2020')
      .attach('annualInspectionFile', smallBuffer, { filename: 'test.txt', contentType: 'text/plain' });

    expect(res.status).toBe(201);
    const vehicle = res.body.vehicle;
    expect(vehicle).toBeDefined();
    const id = vehicle._id;

    // Download the inspection
    const dl = await request(app)
      .get(`/api/vehicles/${id}/inspection`)
      .buffer()
      .parse((res, cb) => { // allow raw buffer
        res.setEncoding('binary');
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => cb(null, Buffer.from(data, 'binary')));
      });

    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toBeDefined();
    expect(dl.body.toString()).toBe('hello-gridfs-test');
  }, 20000);
});

