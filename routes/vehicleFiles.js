import { Router } from "express";
import { downloadVehicleFilesZip, listVehicleFiles } from "../controllers/VehicleFiles.js";

const router = Router();

router.get("/", listVehicleFiles);
router.get("/zip", downloadVehicleFilesZip);

export default router;
