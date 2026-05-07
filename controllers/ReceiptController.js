import PDFDocument from "pdfkit";
import BookingModel from "../models/BookingSchema.js";
import { COMPANY_ID, CompanyModel } from "../models/CompanySchema.js";

function currency(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function pad(label, value, width = 38) {
  const dots = ".".repeat(Math.max(2, width - label.length - String(value).length));
  return `${label}${dots}${value}`;
}

/**
 * GET /bookings/:id/receipt
 * Returns a PDF receipt for a completed booking.
 * Admin-only (uses the standard admin auth middleware applied at the route level).
 */
export async function getBookingReceipt(req, res) {
  const booking = await BookingModel.findById(req.params.id).lean();
  if (!booking) return res.status(404).json({ message: "Booking not found." });
  if (booking.status !== "Completed") {
    return res.status(400).json({ message: "Receipt is only available for completed trips." });
  }

  const company = await CompanyModel.findById(COMPANY_ID).lean().catch(() => null);
  const companyName = company?.name || "TaxiOps";
  const companyPhone = company?.phone || "";
  const companyEmail = company?.email || "";

  const doc = new PDFDocument({ size: "LETTER", margin: 50 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="receipt-${booking.bookingId || booking._id}.pdf"`
  );
  doc.pipe(res);

  // Header
  doc.fontSize(22).font("Helvetica-Bold").text(companyName, { align: "center" });
  if (companyPhone || companyEmail) {
    doc.fontSize(10).font("Helvetica").text(
      [companyPhone, companyEmail].filter(Boolean).join("  |  "),
      { align: "center" }
    );
  }
  doc.moveDown(0.5);
  doc.fontSize(16).font("Helvetica-Bold").text("Trip Receipt", { align: "center" });
  doc.moveDown(1);

  // Trip ID & date
  const completedAt = booking.completedAt || booking.updatedAt;
  doc.fontSize(10).font("Helvetica");
  doc.text(`Booking #: ${booking.bookingId || String(booking._id).slice(-8)}`);
  doc.text(`Date: ${completedAt ? new Date(completedAt).toLocaleString() : "—"}`);
  if (booking.cabNumber) doc.text(`Cab: ${booking.cabNumber}`);
  doc.moveDown(0.8);

  // Trip details
  doc.font("Helvetica-Bold").text("Trip Details");
  doc.font("Helvetica");
  doc.text(`Pickup:  ${booking.pickupAddress || "—"}`);
  if (booking.dropoffAddress) doc.text(`Dropoff: ${booking.dropoffAddress}`);
  if (booking.customerName) doc.text(`Passenger: ${booking.customerName}`);
  if (booking.passengers > 1) doc.text(`Passengers: ${booking.passengers}`);
  doc.moveDown(0.8);

  // Fare breakdown
  doc.font("Helvetica-Bold").text("Fare Breakdown");
  doc.font("Courier").fontSize(10);

  const lineWidth = 46;
  const divider = "-".repeat(lineWidth);

  if (booking.fareStrategy === "flat") {
    doc.text(pad(booking.flatRateName || "Flat rate", currency(booking.flatRateAmount ?? booking.finalFare)));
  } else {
    if (booking.meterMiles != null) {
      doc.text(pad(`Distance (${Number(booking.meterMiles).toFixed(2)} mi)`, "metered"));
    }
    if (booking.waitMinutes != null && booking.waitMinutes > 0) {
      doc.text(pad(`Wait time (${booking.waitMinutes} min)`, "included"));
    }
  }

  const fees = Array.isArray(booking.appliedFees) ? booking.appliedFees : [];
  for (const fee of fees) {
    doc.text(pad(fee.name, currency(fee.amount)));
  }

  doc.text(divider);
  doc.font("Courier-Bold").text(pad("TOTAL", currency(booking.finalFare)));

  doc.moveDown(1.5);
  doc.font("Helvetica").fontSize(9).fillColor("#888888").text("Thank you for riding with us.", { align: "center" });

  doc.end();
}
