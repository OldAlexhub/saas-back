import { Router } from "express";
import { assignBooking, cancelBooking, changeStatus, createBooking, getBookingById, listBookings, updateBooking } from "../controllers/Booking.js";
import { validate } from "../middleware/validate.js";
import { assignBookingSchema, createBookingSchema } from "../validators/bookingSchemas.js";

const router = Router();

router.post("/", validate(createBookingSchema), createBooking);
router.get("/", listBookings);
router.get("/:id", getBookingById);
router.patch("/:id", updateBooking);
router.patch("/:id/assign", validate(assignBookingSchema), assignBooking);
router.patch("/:id/status", changeStatus);
router.post("/:id/cancel", cancelBooking);

export default router;
