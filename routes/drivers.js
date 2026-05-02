import { Router } from "express";
import {
  addDriver,
  getDriverById,
  getEnrollmeImportCandidate,
  importEnrollmeDriver,
  listDrivers,
  listEnrollmeImportCandidates,
  setDriverAppCredentials,
  updateDriver,
} from "../controllers/Drivers.js";
import { listDriverLocationTimeline } from "../controllers/DriverLocationTimeline.js";
import { validate } from "../middleware/validate.js";
import { createDriverSchema } from "../validators/driverSchemas.js";

const router = Router();

router.post("/", validate(createDriverSchema), addDriver);
router.get("/", listDrivers);
router.get("/location-timeline", listDriverLocationTimeline);
router.get("/enrollme/applications", listEnrollmeImportCandidates);
router.get("/enrollme/applications/:id", getEnrollmeImportCandidate);
router.post("/enrollme/applications/:id/import", importEnrollmeDriver);
router.get("/:id", getDriverById);
router.put("/:id", updateDriver);
router.patch("/:id/app-credentials", setDriverAppCredentials);

export default router;
