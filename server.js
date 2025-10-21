import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

import config from "./config/index.js";
import connectTodb from "./db/connectTodb.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { initRealtime } from "./realtime/index.js";
import router, { driverAppRouter } from "./routes/routes.js";

// APP
const app = express();
const PORT = config.port;

// MIDDLEWARE
app.use(cors());
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: "32mb", extended: true }));
app.use(express.urlencoded({ limit: "32mb", extended: true }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
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

// SERVER HEALTH
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(__dirname, "./public");
app.use(express.static(publicDirectory));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ROUTES
app.use("/api/driver-app", driverAppRouter);
app.use("/api", router);

// 404 & ERROR HANDLING
app.use(notFound);
app.use(errorHandler);

// DATABASE & SERVER START
const httpServer = createServer(app);

connectTodb()
  .then(async () => {
    // If diagnostics retention is configured, ensure TTL index exists
    try {
      // lazy-import model to avoid top-level cyclic imports
      const DriverDiagnosticsModel = await import("./models/DriverDiagnostics.js");
      const retentionDays = config.diagnostics && config.diagnostics.retentionDays;
      if (retentionDays && Number.isFinite(retentionDays)) {
        const seconds = Math.floor(retentionDays * 24 * 60 * 60);
        // create TTL index on createdAt; Mongo will remove docs older than `seconds`
        DriverDiagnosticsModel.default.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: seconds })
          .then(() => console.log(`Driver diagnostics TTL index ensured (${retentionDays} days)`))
          .catch((idxErr) => console.warn('Failed to ensure diagnostics TTL index', idxErr.message || idxErr));
      }
    } catch (e) {
      console.warn('Could not ensure diagnostics TTL index:', e && e.message ? e.message : e);
    }
    initRealtime(httpServer);
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database connection failed. Exiting...", err.message);
    process.exit(1);
  });
