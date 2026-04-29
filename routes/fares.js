import { Router } from "express";
import { addFare, getFare, updateFare } from "../controllers/Fares.js";
import { createFlatRate, deleteFlatRate, listFlatRates, updateFlatRate } from "../controllers/FlatRates.js";

const router = Router();

router.post("/", addFare);
router.put("/", updateFare);
router.get("/current", getFare);
router.get("/flatrates", listFlatRates);
router.post("/flatrates", createFlatRate);
router.put("/flatrates/:id", updateFlatRate);
router.delete("/flatrates/:id", deleteFlatRate);

export default router;
