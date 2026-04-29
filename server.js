import createHttpServer from 'http';
import app from './app.js';
import config from './config/index.js';
import connectTodb from './db/connectTodb.js';
import { initRealtime } from './realtime/index.js';
import logger from './utils/logger.js';

// Route all console calls through the structured pino logger so every log
// statement in every controller/middleware benefits from redaction and level filtering.
console.log = (...args) => logger.info(args.map(String).join(' '));
console.info = (...args) => logger.info(args.map(String).join(' '));
console.warn = (...args) => logger.warn(args.map(String).join(' '));
console.error = (...args) => logger.error(args.map(String).join(' '));
console.debug = (...args) => logger.debug(args.map(String).join(' '));

const PORT = config.port;

let httpServer;

export async function start() {
  await connectTodb();
  httpServer = createHttpServer.createServer(app);
  initRealtime(httpServer);
  try {
    // Start background scheduler for driver messages (sends scheduled messages at their run time)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { startDriverMessageScheduler } = await import('./schedulers/driverMessageScheduler.js');
    try {
      startDriverMessageScheduler();
      console.log('Driver message scheduler started');
    } catch (err) {
      console.warn('Failed to start driver message scheduler', err?.message || err);
    }
  } catch (_e) {
    // best-effort; continue even if scheduler module fails to load
  }
  try {
    // Start HOS retention scheduler (daily cleanup of old HOS records)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { startHosRetentionScheduler } = await import('./schedulers/hosRetentionScheduler.js');
    try {
      startHosRetentionScheduler();
      console.log('HOS retention scheduler started');
    } catch (err) {
      console.warn('Failed to start HOS retention scheduler', err?.message || err);
    }
  } catch (_e) {
    // best-effort; continue even if scheduler module fails to load
  }
  return new Promise((resolve) => {
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      resolve();
    });
  });
}

// If server.js is run directly, start the server
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  start().catch((err) => {
    console.error('Failed to start server', err.message || err);
    process.exit(1);
  });
}

export default app;
