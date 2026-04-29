import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import router, { driverAppRouter } from './routes/routes.js';
import logger from './utils/logger.js';

const app = express();

app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '32mb', extended: true }));
app.use(express.urlencoded({ limit: '32mb', extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const entry = { method: req.method, url: req.originalUrl, status: res.statusCode, ms: duration };
    if (res.statusCode >= 500) logger.error(entry);
    else if (res.statusCode >= 400) logger.warn(entry);
    else logger.info(entry);
  });
  next();
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(__dirname, './public');
app.use(express.static(publicDirectory));

app.use(generalLimiter);

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.use('/api/v1/driver-app', driverAppRouter);
app.use('/api/v1', router);

app.use(notFound);
app.use(errorHandler);

export default app;
