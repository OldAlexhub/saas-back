import express from 'express';
import request from 'supertest';
import { createAuthLimiter, createGeneralLimiter } from '../middleware/rateLimiter.js';

describe('rate limiter routing', () => {
  test('does not apply the global API limiter to driver app traffic', async () => {
    const app = express();
    app.use(createGeneralLimiter({ windowMs: 60_000, max: 1 }));
    app.get('/api/v1/driver-app/me', (_req, res) => res.json({ ok: true }));
    app.get('/api/v1/drivers', (_req, res) => res.json({ ok: true }));

    await request(app).get('/api/v1/driver-app/me').expect(200);
    await request(app).get('/api/v1/driver-app/me').expect(200);

    await request(app).get('/api/v1/drivers').expect(200);
    await request(app).get('/api/v1/drivers').expect(429);
  });

  test('login limiter buckets attempts by login identity', async () => {
    const app = express();
    app.use(express.json());
    app.post('/api/v1/driver-app/auth/login', createAuthLimiter({ windowMs: 60_000, max: 1 }), (_req, res) => {
      res.status(401).json({ message: 'Invalid credentials.' });
    });

    await request(app)
      .post('/api/v1/driver-app/auth/login')
      .send({ identifier: 'driver-a', password: 'bad' })
      .expect(401);
    await request(app)
      .post('/api/v1/driver-app/auth/login')
      .send({ identifier: 'driver-a', password: 'bad' })
      .expect(429);
    await request(app)
      .post('/api/v1/driver-app/auth/login')
      .send({ identifier: 'driver-b', password: 'bad' })
      .expect(401);
  });
});
