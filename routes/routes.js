import { Router } from "express";
import { getCompanyProfile, updateCompanyProfile } from "../controllers/Company.js";
import { listDiagnostics } from "../controllers/AdminDiagnostics.js";
import {
  listEnrollmeAdminsController,
  createEnrollmeAdminController,
  updateEnrollmeAdminController,
  deleteEnrollmeAdminController,
} from "../controllers/EnrollmeAdmin.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { enrollmeCreateAdminSchema, enrollmeUpdateAdminSchema } from "../validators/enrollmeSchemas.js";
import activesRouter from "./actives.js";
import adminsRouter from "./admins.js";
import bookingsRouter from "./bookings.js";
import driverAppRouter from "./driverApp.js";
import driversRouter from "./drivers.js";
import enrollmeRouter from "./enrollme.js";
import faresRouter from "./fares.js";
import reportsRouter from "./reports.js";
import vehiclesRouter from "./vehicles.js";
import vehicleFilesRouter from "./vehicleFiles.js";
import messagesRouter from "./messages.js";

const router = Router();

// ---- Public / pre-auth routes ----
router.use("/admins", adminsRouter);
router.use("/enrollme", enrollmeRouter);
router.get("/company/profile", getCompanyProfile);

// ---- Auth gate: everything below requires admin ----
router.use((req, res, next) => {
    if (process.env.DISABLE_AUTH === "true" || process.env.DISABLE_AUTH === "1") {
        return next();
    }
    return authenticate(req, res, (err) => {
        if (err) return next(err);
        return requireAdmin(req, res, next);
    });
});

router.put("/company/profile", updateCompanyProfile);
router.get("/admin/diagnostics", listDiagnostics);
router.get("/enrollme-admins", listEnrollmeAdminsController);
router.post("/enrollme-admins", validate(enrollmeCreateAdminSchema), createEnrollmeAdminController);
router.patch("/enrollme-admins/:id", validate(enrollmeUpdateAdminSchema), updateEnrollmeAdminController);
router.delete("/enrollme-admins/:id", deleteEnrollmeAdminController);
router.use("/drivers", driversRouter);
router.use("/vehicles", vehiclesRouter);
router.use("/vehicle-files", vehicleFilesRouter);
router.use("/actives", activesRouter);
router.use("/fares", faresRouter);
router.use("/bookings", bookingsRouter);
router.use("/messages", messagesRouter);
router.use("/reports", reportsRouter);

export { driverAppRouter };
export default router;
