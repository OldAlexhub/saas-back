import { Router } from "express";
import {
  acknowledgeNemtRun,
  getMyNemtFinance,
  getMyNemtRuns,
  getNemtRunById,
  reportNemtTripIssue,
  updateNemtTripStatus,
} from "../controllers/NemtDriverApp.js";
import { validate } from "../middleware/validate.js";
import { driverTripStatusSchema, reportIssueSchema } from "../validators/nemtSchemas.js";

const router = Router();

// All routes here are mounted behind authenticateDriver in driverApp.js.

router.get("/runs", getMyNemtRuns);
router.get("/runs/:id", getNemtRunById);
router.post("/runs/:id/acknowledge", acknowledgeNemtRun);
router.patch("/trips/:id/status", validate(driverTripStatusSchema), updateNemtTripStatus);
router.post("/trips/:id/report-issue", validate(reportIssueSchema), reportNemtTripIssue);
router.get("/finance", getMyNemtFinance);

export default router;
