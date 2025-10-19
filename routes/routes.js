import { Router } from "express";
import multer from "multer";
import path from "path";

import { authenticate, requireAdmin } from "../middleware/auth.js";
import config from "../config/index.js";

// Controllers
import {
  addActive,
  getActiveById,
  getAllActives,
  setAvailability,
  setStatus,
  updateActive,
} from "../controllers/Activate.js";
import {
  addAdmins,
  AdminLogin,
  listAdmins,
  updateApproval,
} from "../controllers/Admins.js";
import {
  addDriver,
  getDriverById,
  listDrivers,
  setDriverAppCredentials,
  updateDriver,
} from "../controllers/Drivers.js";
import { listDriverLocationTimeline } from "../controllers/DriverLocationTimeline.js";
import {
  assignBooking,
  cancelBooking,
  changeStatus,
  createBooking,
  getBookingById,
  listBookings,
  updateBooking,
} from "../controllers/Booking.js";
import { addFare, getFare, updateFare } from "../controllers/Fares.js";
import {
  createFlatRate,
  deleteFlatRate,
  listFlatRates,
  updateFlatRate,
} from "../controllers/FlatRates.js";
import {
  addVehicle,
  getVehicle,
  listVehicles,
  updateVehicle,
} from "../controllers/Vehicles.js";
import {
  getCompanyProfile,
  updateCompanyProfile,
} from "../controllers/Company.js";
import {
  changeDriverPassword,
  loginDriver,
  logoutDriver,
} from "../controllers/DriverAppAuth.js";
import {
  acknowledgeMyBooking,
  declineMyBooking,
  createFlagdownRide,
  getCurrentAssignment,
  getDriverProfile,
  getDriverFare,
  listMyBookings,
  reportBookingLocation,
  updateMyBookingStatus,
  updatePresence,
  registerDriverPushToken,
} from "../controllers/DriverApp.js";
import { authenticateDriver } from "../middleware/driverAuth.js";
import {
  createDriverMessage,
  deleteDriverMessage,
  listDriverMessages,
  sendDriverMessageNow,
  updateDriverMessage,
} from "../controllers/DriverMessages.js";

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
router.put("/vehicles/:id", upload.single("annualInspectionFile"), updateVehicle);

// =================== ACTIVE ===================
router.post("/actives", addActive);
router.put("/actives/:id", updateActive);
router.put("/actives/:id/status", setStatus);
router.put("/actives/:id/availability", setAvailability);
router.get("/actives", getAllActives);
router.get("/actives/:id", getActiveById);

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

export { driverAppRouter };
export default router;
