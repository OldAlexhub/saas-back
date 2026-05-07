import multer from "multer";
import { Router } from "express";
import {
  createAgency, deactivateAgency, getAgencyById, listAgencies, updateAgency,
} from "../controllers/NemtAgencies.js";
import {
  bulkCreateTrips, cancelTrip, createTrip, getTripById, importTrips,
  listTrips, markNoShow, updateTrip,
} from "../controllers/NemtTrips.js";
import { commitImportBatch, getImportBatch, stageImport } from "../controllers/NemtImports.js";
import {
  addTripToRun, autoAssignRuns, cancelRun, createRun, dispatchRun, getRunById,
  listRuns, optimizeRunController, previewRunOptimization, applyRunOptimization,
  reorderRun, removeTripFromRun, updateRun,
} from "../controllers/NemtRuns.js";
import { getNemtSettings, updateNemtSettings } from "../controllers/NemtSettings.js";
import {
  agencyBillingReport, cancellationsReport, driverActivityReport, liveRunsSnapshot,
  otpReport, runsReport, tripSummaryReport,
} from "../controllers/NemtReports.js";
import {
  createBillingBatch, createPayBatch, getBillingBatch, getPayBatch,
  getUnbilledTrips, getUnpaidTrips, listBillingBatches, listPayBatches,
  updateBillingBatch, updatePayBatch,
} from "../controllers/NemtPay.js";
import { validate } from "../middleware/validate.js";
import {
  addTripToRunSchema,
  autoAssignRunsSchema,
  bulkCreateTripsSchema,
  cancelRunSchema,
  cancelTripSchema,
  createAgencySchema,
  createBillingBatchSchema,
  createPayBatchSchema,
  createRunSchema,
  createTripSchema,
  noShowTripSchema,
  reorderRunSchema,
  updateAgencySchema,
  updateBillingBatchSchema,
  updateNemtSettingsSchema,
  updatePayBatchSchema,
  updateRunSchema,
  updateTripSchema,
} from "../validators/nemtSchemas.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = Router();

// ---- Agencies ----
router.get("/agencies", listAgencies);
router.post("/agencies", validate(createAgencySchema), createAgency);
router.get("/agencies/:id", getAgencyById);
router.patch("/agencies/:id", validate(updateAgencySchema), updateAgency);
router.delete("/agencies/:id", deactivateAgency);

// ---- Trips ----
// Note: /trips/bulk and /trips/import must come before /trips/:id to avoid
// Express matching "bulk" or "import" as an :id parameter.
router.get("/trips", listTrips);
router.post("/trips/bulk", validate(bulkCreateTripsSchema), bulkCreateTrips);
router.post("/trips/import", upload.single("file"), importTrips);
router.post("/trips", validate(createTripSchema), createTrip);
router.get("/trips/:id", getTripById);
router.patch("/trips/:id", validate(updateTripSchema), updateTrip);
router.post("/trips/:id/cancel", validate(cancelTripSchema), cancelTrip);
router.post("/trips/:id/no-show", validate(noShowTripSchema), markNoShow);

// ---- Import staging ----
router.post("/imports/stage", upload.single("file"), stageImport);
router.get("/imports/:id", getImportBatch);
router.post("/imports/:id/commit", commitImportBatch);

// ---- Runs ----
router.post("/runs/auto-assign", validate(autoAssignRunsSchema), autoAssignRuns);
router.get("/runs", listRuns);
router.post("/runs", validate(createRunSchema), createRun);
router.get("/runs/:id", getRunById);
router.patch("/runs/:id", validate(updateRunSchema), updateRun);
router.patch("/runs/:id/reorder", validate(reorderRunSchema), reorderRun);
router.post("/runs/:id/trips", validate(addTripToRunSchema), addTripToRun);
router.delete("/runs/:runId/trips/:tripId", removeTripFromRun);
router.post("/runs/:id/optimize", optimizeRunController);
router.post("/runs/:id/reoptimize/preview", previewRunOptimization);
router.post("/runs/:id/reoptimize/apply", applyRunOptimization);
router.post("/runs/:id/dispatch", dispatchRun);
router.post("/runs/:id/cancel", validate(cancelRunSchema), cancelRun);

// ---- Settings ----
router.get("/settings", getNemtSettings);
router.put("/settings", validate(updateNemtSettingsSchema), updateNemtSettings);

// ---- Agency Billing ----
router.get("/billing/batches", listBillingBatches);
router.get("/billing/batches/:id", getBillingBatch);
router.post("/billing/batches", validate(createBillingBatchSchema), createBillingBatch);
router.patch("/billing/batches/:id", validate(updateBillingBatchSchema), updateBillingBatch);
router.get("/billing/unbilled", getUnbilledTrips);

// ---- Driver Pay ----
router.get("/pay/batches", listPayBatches);
router.get("/pay/batches/:id", getPayBatch);
router.post("/pay/batches", validate(createPayBatchSchema), createPayBatch);
router.patch("/pay/batches/:id", validate(updatePayBatchSchema), updatePayBatch);
router.get("/pay/unpaid", getUnpaidTrips);

// ---- Reports ----
router.get("/reports/otp", otpReport);
router.get("/reports/trips", tripSummaryReport);
router.get("/reports/driver-activity", driverActivityReport);
router.get("/reports/agency-billing", agencyBillingReport);
router.get("/reports/runs", runsReport);
router.get("/reports/cancellations", cancellationsReport);
router.get("/reports/live-runs", liveRunsSnapshot);

export default router;
