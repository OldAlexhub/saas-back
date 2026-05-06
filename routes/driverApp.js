import { Router } from "express";
import {
    acknowledgeMyBooking,
    appendHos,
    createFlagdownRide,
    cancelTripSession,
    completeTripSession,
    declineMyBooking,
    endDuty,
    getCurrentAssignment,
    getDriverFare,
    getDriverProfile,
    getDutyLogs,
    getHosSummary,
    listMyBookings,
    heartbeatTripSession,
    recoverActiveTrip,
    registerDriverPushToken,
    reportBookingLocation,
    startTripSession,
    startDuty,
    syncTripEvents,
    updateMyBookingStatus,
    updatePresence,
} from "../controllers/DriverApp.js";
import { changeDriverPassword, loginDriver, logoutDriver } from "../controllers/DriverAppAuth.js";
import { driverAcknowledgeMessage, driverSnoozeMessage } from "../controllers/DriverMessages.js";
import nemtDriverAppRouter from "./nemtDriverApp.js";
import { authenticateDriver } from "../middleware/driverAuth.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import { driverLoginSchema } from "../validators/driverSchemas.js";

const router = Router();

router.post("/auth/login", authLimiter, validate(driverLoginSchema), loginDriver);
router.post("/auth/logout", authenticateDriver, logoutDriver);
router.post("/auth/password", authenticateDriver, changeDriverPassword);

router.use(authenticateDriver);

router.get("/me", getDriverProfile);
router.get("/fare", getDriverFare);
router.get("/bookings", listMyBookings);
router.get("/bookings/current", getCurrentAssignment);
router.get("/trips/active", recoverActiveTrip);
router.post("/trips/start", startTripSession);
router.post("/trips/:id/heartbeat", heartbeatTripSession);
router.post("/trips/:id/events", syncTripEvents);
router.post("/trips/:id/complete", completeTripSession);
router.post("/trips/:id/cancel", cancelTripSession);
router.post("/bookings/:id/acknowledge", acknowledgeMyBooking);
router.post("/bookings/:id/decline", declineMyBooking);
router.patch("/bookings/:id/status", updateMyBookingStatus);
router.post("/bookings/:id/location", reportBookingLocation);
router.post("/flagdowns", createFlagdownRide);
router.patch("/presence", updatePresence);
router.post("/push-token", registerDriverPushToken);
router.post("/messages/:id/acknowledge", driverAcknowledgeMessage);
router.post("/messages/:id/snooze", driverSnoozeMessage);
router.post("/hos", appendHos);
router.post("/hos/start", startDuty);
router.post("/hos/end", endDuty);
router.get("/hos", getHosSummary);
router.get("/hos/:driverId", getHosSummary);
router.get("/hos/logs", getDutyLogs);
router.get("/hos/logs/:driverId", getDutyLogs);
router.use("/nemt", nemtDriverAppRouter);

router.post("/diagnostics", async (req, res) => {
    try {
        const { uploadDiagnostics } = await import("../controllers/DriverApp.js");
        return await uploadDiagnostics(req, res);
    } catch (err) {
        console.error("Diagnostics route error", err);
        return res.status(500).json({ message: "Failed to handle diagnostics upload" });
    }
});

export default router;
