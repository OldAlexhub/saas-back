import { Router } from "express";
import {
    createDriverMessage,
    deleteDriverMessage,
    listDriverMessages,
    sendDriverMessageNow,
    updateDriverMessage,
} from "../controllers/DriverMessages.js";

const router = Router();

router.get("/", listDriverMessages);
router.post("/", createDriverMessage);
router.post("/send-now", sendDriverMessageNow);
router.patch("/:id", updateDriverMessage);
router.delete("/:id", deleteDriverMessage);

export default router;
