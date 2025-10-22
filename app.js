import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

import { errorHandler, notFound } from './middleware/errorHandler.js';
import router, { driverAppRouter } from './routes/routes.js';

const app = express();

app.use(cors());
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '32mb', extended: true }));
app.use(express.urlencoded({ limit: '32mb', extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
    if (res.statusCode >= 500) {
      console.error(log);
    } else if (res.statusCode >= 400) {
      console.warn(log);
    } else {
      console.log(log);
    }
  });
  next();
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(__dirname, './public');
app.use(express.static(publicDirectory));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.use('/api/driver-app', driverAppRouter);
app.use('/api', router);

app.use(notFound);
app.use(errorHandler);

export default app;
