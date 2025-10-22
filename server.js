import createHttpServer from 'http';
import app from './app.js';
import config from './config/index.js';
import connectTodb from './db/connectTodb.js';
import { initRealtime } from './realtime/index.js';

const PORT = config.port;

let httpServer;

export async function start() {
  await connectTodb();
  httpServer = createHttpServer.createServer(app);
  initRealtime(httpServer);
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
