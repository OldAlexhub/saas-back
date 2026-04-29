import { Router } from "express";
import { addActive, getActiveById, getAllActives, setAvailability, setStatus, updateActive } from "../controllers/Activate.js";

const router = Router();

router.post("/", addActive);
router.get("/", getAllActives);
router.get("/:id", getActiveById);
router.put("/:id", updateActive);
router.put("/:id/status", setStatus);
router.put("/:id/availability", setAvailability);

export default router;
