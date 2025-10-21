import { Router } from "express";
import multer from "multer";
import path from "path";

import config from "../config/index.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

// Controllers
import {
    addActive,
    getActiveById,
    getAllActives,
    setAvailability,
    setStatus,
    updateActive,
} from "../controllers/Activate.js";
import { listDiagnostics } from "../controllers/AdminDiagnostics.js";
import {
    addAdmins,
    AdminLogin,
    listAdmins,
    updateApproval,
} from "../controllers/Admins.js";
import {
    assignBooking,
    cancelBooking,
    changeStatus,
    createBooking,
    getBookingById,
    listBookings,
    updateBooking,
} from "../controllers/Booking.js";
import {
    getCompanyProfile,
    updateCompanyProfile,
} from "../controllers/Company.js";
import {
    acknowledgeMyBooking,
    createFlagdownRide,
    declineMyBooking,
    getCurrentAssignment,
    getDriverFare,
    getDriverProfile,
    listMyBookings,
    registerDriverPushToken,
    reportBookingLocation,
    updateMyBookingStatus,
    updatePresence,
} from "../controllers/DriverApp.js";
import {
    changeDriverPassword,
    loginDriver,
    logoutDriver,
} from "../controllers/DriverAppAuth.js";
import { listDriverLocationTimeline } from "../controllers/DriverLocationTimeline.js";
import {
    createDriverMessage,
    deleteDriverMessage,
    listDriverMessages,
    sendDriverMessageNow,
    updateDriverMessage,
} from "../controllers/DriverMessages.js";
import {
    addDriver,
    getDriverById,
    listDrivers,
    setDriverAppCredentials,
    updateDriver,
} from "../controllers/Drivers.js";
import { addFare, getFare, updateFare } from "../controllers/Fares.js";
import {
    createFlatRate,
    deleteFlatRate,
    listFlatRates,
    updateFlatRate,
} from "../controllers/FlatRates.js";
import { downloadVehicleFilesZip, listVehicleFiles } from "../controllers/VehicleFiles.js";
import {
    addVehicle,
    getVehicle,
    listVehicles,
    updateVehicle,
} from "../controllers/Vehicles.js";
import { authenticateDriver } from "../middleware/driverAuth.js";

const router = Router();
const driverAppRouter = Router();

// --- Uploads (store on disk) ---
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploads.vehiclesDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "");
      const stamp = Date.now();
      cb(null, `${base || "inspection"}-${stamp}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// =================== AUTH =======================
router.post("/admins", addAdmins); // signup
router.post("/admins/login", AdminLogin); // login
router.put("/admins/:id/approval", authenticate, requireAdmin, updateApproval);
router.get("/company/profile", getCompanyProfile);

// Require auth for everything below
router.use(authenticate, requireAdmin);

router.get("/admins", listAdmins);
router.put("/company/profile", updateCompanyProfile);
router.get("/messages", listDriverMessages);
router.post("/messages", createDriverMessage);
router.post("/messages/send-now", sendDriverMessageNow);
router.patch("/messages/:id", updateDriverMessage);
router.delete("/messages/:id", deleteDriverMessage);

// =================== DRIVERS ==================
router.post("/drivers", addDriver);
router.get("/drivers", listDrivers);
router.get("/drivers/location-timeline", listDriverLocationTimeline);
router.get("/drivers/:id", getDriverById);
router.put("/drivers/:id", updateDriver);
router.patch("/drivers/:id/app-credentials", setDriverAppCredentials);

// =================== VEHICLES =================
router.get("/vehicles", listVehicles);
router.post("/vehicles", upload.single("annualInspectionFile"), addVehicle);
router.get("/vehicles/:id", getVehicle);
// Authenticated download of a vehicle's inspection file (admins only)
router.get("/vehicles/:id/inspection", authenticate, requireAdmin, downloadInspectionFile);
router.put("/vehicles/:id", upload.single("annualInspectionFile"), updateVehicle);
// Vehicle files: list and batch download (zip)
router.get('/vehicle-files', listVehicleFiles);
router.get('/vehicle-files/zip', downloadVehicleFilesZip);

// =================== ACTIVE ===================
router.post("/actives", addActive);
router.put("/actives/:id", updateActive);
router.put("/actives/:id/status", setStatus);
router.put("/actives/:id/availability", setAvailability);
router.get("/actives", getAllActives);
router.get("/actives/:id", getActiveById);

// Admin diagnostics viewer
router.get('/diagnostics', listDiagnostics);

// =================== FARES ====================
router.post("/fares", addFare);
router.put("/fares", updateFare);
router.get("/fares/current", getFare);
router.get("/fares/flatrates", listFlatRates);
router.post("/fares/flatrates", createFlatRate);
router.put("/fares/flatrates/:id", updateFlatRate);
router.delete("/fares/flatrates/:id", deleteFlatRate);

// =================== BOOKINGS =================
router.post("/bookings", createBooking);
router.get("/bookings", listBookings);
router.get("/bookings/:id", getBookingById);
router.patch("/bookings/:id", updateBooking);
router.patch("/bookings/:id/assign", assignBooking);
router.patch("/bookings/:id/status", changeStatus);
router.post("/bookings/:id/cancel", cancelBooking);

// ================= DRIVER APP =================
driverAppRouter.post("/auth/login", loginDriver);
driverAppRouter.post("/auth/logout", authenticateDriver, logoutDriver);
driverAppRouter.post("/auth/password", authenticateDriver, changeDriverPassword);

driverAppRouter.use(authenticateDriver);

driverAppRouter.get("/me", getDriverProfile);
driverAppRouter.get("/fare", getDriverFare);
driverAppRouter.get("/bookings", listMyBookings);
driverAppRouter.get("/bookings/current", getCurrentAssignment);
driverAppRouter.post("/bookings/:id/acknowledge", acknowledgeMyBooking);
driverAppRouter.post("/bookings/:id/decline", declineMyBooking);
driverAppRouter.patch("/bookings/:id/status", updateMyBookingStatus);
driverAppRouter.post("/bookings/:id/location", reportBookingLocation);
driverAppRouter.post("/flagdowns", createFlagdownRide);
driverAppRouter.patch("/presence", updatePresence);
driverAppRouter.post("/push-token", registerDriverPushToken);
// Hours-of-service endpoints (driver POSTs deltas, admin/driver can read summary)
driverAppRouter.post('/hos', appendHos);
driverAppRouter.get('/hos/:driverId?', getHosSummary);
// Upload diagnostics from driver app (requires driver auth)
driverAppRouter.post('/diagnostics', uploadDiagnostics);

export { driverAppRouter };
export default router;
