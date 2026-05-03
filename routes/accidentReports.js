import { Router } from "express";
import {
  createAccidentReport,
  getAccidentReport,
  listAccidentReports,
  listDriversForAccident,
  listVehiclesForAccident,
  updateAccidentReport,
} from "../controllers/AccidentReports.js";

const router = Router();

router.get("/drivers", listDriversForAccident);
router.get("/vehicles", listVehiclesForAccident);
router.get("/", listAccidentReports);
router.post("/", createAccidentReport);
router.get("/:id", getAccidentReport);
router.patch("/:id", updateAccidentReport);

export default router;
