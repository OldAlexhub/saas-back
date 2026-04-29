import { Router } from "express";
import multer from "multer";
import { downloadVehicleFilesZip, listVehicleFiles } from "../controllers/VehicleFiles.js";
import { addVehicle, downloadInspectionFile, getVehicle, listVehicles, listVehiclesByCabs, updateVehicle } from "../controllers/Vehicles.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.get("/", listVehicles);
router.post("/", upload.single("annualInspectionFile"), addVehicle);
router.post("/by-cabs", listVehiclesByCabs);
router.get("/:id", getVehicle);
router.get("/:id/inspection", authenticate, requireAdmin, downloadInspectionFile);
router.put("/:id", upload.single("annualInspectionFile"), updateVehicle);

export { upload };
export default router;
