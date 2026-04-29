import mongoose from "mongoose";
import ActiveModel from "../models/ActiveSchema.js";
import BookingModel from "../models/BookingSchema.js";
import DriverDutyModel from "../models/DriverDuty.js";
import DriverHOSModel from "../models/DriverHOS.js";
import DriverLocationTimelineModel from "../models/DriverLocationTimeline.js";
import DriverModel from "../models/DriverSchema.js";
import { FareModel } from "../models/FareSchema.js";
import VehicleModel from "../models/VehicleSchema.js";

// Minimal, safe reports controller that supports a small query DSL for two-table joins.
// Payload example:
// { left: 'bookings', right: 'drivers', leftKey: 'driverId', rightKey: 'driverId', fields: { left: ['bookingId','pickupTime'], right: ['firstName','lastName'] }, limit: 100 }

const MODEL_MAP = {
  bookings: mongoose.models.bookings || BookingModel,
  driverTimeline: mongoose.models.driver_location_timeline || DriverLocationTimelineModel,
  drivers: mongoose.models.Driver || DriverModel,
  vehicles: mongoose.models.vehicles || VehicleModel,
  actives: mongoose.models.actives || ActiveModel,
  fares: mongoose.models.fares || FareModel,
};

const EXPIRY_WARNING_DAYS = 45;
const MAX_REPORT_LIMIT = 5000;

function resolveModel(name) {
  return MODEL_MAP[name];
}

function toFiniteLimit(value, fallback = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), MAX_REPORT_LIMIT);
}

function parseDateBoundary(value, endOfDay = false) {
  if (!value) return null;
  const raw = String(value).trim();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    date.setUTCHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  }
  return date;
}

function parseDateRange(query = {}, { defaultDays = null } = {}) {
  let from = parseDateBoundary(query.from, false);
  let to = parseDateBoundary(query.to, true);

  if (!from && !to && defaultDays) {
    to = new Date();
    from = new Date(to.getTime() - (defaultDays - 1) * 24 * 60 * 60 * 1000);
    from.setUTCHours(0, 0, 0, 0);
  }

  return { from, to };
}

function dateOnly(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function safeDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function iso(value) {
  const date = safeDate(value);
  return date ? date.toISOString() : "";
}

function round(value, digits = 2) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function minutesBetween(start, end) {
  const startDate = safeDate(start);
  const endDate = safeDate(end) || new Date();
  if (!startDate || !endDate) return 0;
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
}

function driverDisplayName(driver) {
  if (!driver) return "";
  return [driver.firstName, driver.lastName].filter(Boolean).join(" ").trim() || driver.email || driver.driverId || "";
}

function buildDriverMap(drivers = []) {
  const map = new Map();
  drivers.forEach((driver) => {
    if (!driver) return;
    if (driver.driverId) map.set(String(driver.driverId), driver);
    if (driver._id) map.set(String(driver._id), driver);
  });
  return map;
}

function getFeesTotal(booking) {
  return Array.isArray(booking?.appliedFees)
    ? booking.appliedFees.reduce((sum, fee) => sum + Number(fee?.amount || 0), 0)
    : 0;
}

function getTripTotal(booking) {
  const base =
    booking?.finalFare ??
    booking?.estimatedFare ??
    booking?.flatRateAmount ??
    0;
  return Number(base || 0) + getFeesTotal(booking);
}

function expiryStatus(dateValue, dueWithinDays = EXPIRY_WARNING_DAYS) {
  const expiry = safeDate(dateValue);
  if (!expiry) return { status: "missing", daysRemaining: null };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(expiry);
  target.setHours(0, 0, 0, 0);
  const daysRemaining = Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  if (daysRemaining < 0) return { status: "expired", daysRemaining };
  if (daysRemaining <= dueWithinDays) return { status: "dueSoon", daysRemaining };
  return { status: "compliant", daysRemaining };
}

function worstComplianceStatus(statuses = []) {
  if (statuses.includes("expired")) return "expired";
  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("dueSoon")) return "dueSoon";
  return "compliant";
}

function complianceLabel(status) {
  switch (status) {
    case "expired":
      return "Expired";
    case "missing":
      return "Missing";
    case "dueSoon":
      return "Due soon";
    default:
      return "Compliant";
  }
}

export async function queryReports(req, res) {
  try {
    try {
      res.setHeader("X-Legacy-Reports", "true");
      if (process.env.LEGACY_REPORTS_DEPRECATE === "true") {
        console.warn("Legacy reports endpoint /api/reports/query was invoked; consider migrating callers to the reporting APIs.");
      }
    } catch (_err) {
      // Header diagnostics are best-effort only.
    }

    const { left, right, leftKey, rightKey, fields = {}, limit = 500 } = req.body || {};

    if (!left || !right || !leftKey || !rightKey) {
      return res.status(400).json({ message: "left,right,leftKey and rightKey are required" });
    }

    const leftModel = resolveModel(left);
    const rightModel = resolveModel(right);
    if (!leftModel || !rightModel) {
      return res.status(400).json({ message: "Unknown dataset name" });
    }

    const pipeline = [];
    const parsedLimit = toFiniteLimit(limit, 500);
    if (parsedLimit > 0) pipeline.push({ $limit: parsedLimit });

    pipeline.push({
      $lookup: {
        from: rightModel.collection.name,
        localField: leftKey,
        foreignField: rightKey,
        as: "__right",
      },
    });
    pipeline.push({ $unwind: "$__right" });

    const leftFields = (fields.left || []).reduce((acc, field) => ({ ...acc, [field]: `$${field}` }), {});
    const rightFields = (fields.right || []).reduce((acc, field) => ({ ...acc, [`right_${field}`]: `$__right.${field}` }), {});
    const project = { _id: 0, ...leftFields, ...rightFields };

    if (Object.keys(project).length === 1) {
      pipeline.push({ $project: { _id: 0, left: "$$ROOT", right: "$__right" } });
    } else {
      pipeline.push({ $project: project });
    }

    const results = await leftModel.aggregate(pipeline).allowDiskUse(true).exec();
    return res.json({ data: results });
  } catch (err) {
    console.error("Reports query error", err);
    return res.status(500).json({ message: "Unable to run report query", error: String(err) });
  }
}

export async function tripDataReport(req, res) {
  try {
    const {
      status,
      driverId,
      cabNumber,
      tripSource,
      dispatchMethod,
      dateField = "pickupTime",
    } = req.query || {};
    const limit = toFiniteLimit(req.query?.limit, 1000);
    const { from, to } = parseDateRange(req.query, { defaultDays: 30 });
    const allowedDateFields = new Set(["pickupTime", "completedAt", "createdAt"]);
    const selectedDateField = allowedDateFields.has(dateField) ? dateField : "pickupTime";

    const query = {};
    if (status && status !== "all") query.status = status;
    if (driverId) query.driverId = String(driverId);
    if (cabNumber) query.cabNumber = String(cabNumber);
    if (tripSource && tripSource !== "all") query.tripSource = String(tripSource);
    if (dispatchMethod && dispatchMethod !== "all") query.dispatchMethod = String(dispatchMethod);
    if (from || to) {
      query[selectedDateField] = {};
      if (from) query[selectedDateField].$gte = from;
      if (to) query[selectedDateField].$lte = to;
    }

    const bookings = await BookingModel.find(query)
      .sort({ [selectedDateField]: -1, pickupTime: -1 })
      .limit(limit)
      .lean();

    const driverIds = [...new Set(bookings.map((booking) => booking.driverId).filter(Boolean).map(String))];
    const drivers = driverIds.length
      ? await DriverModel.find({ driverId: { $in: driverIds } }).select("-ssn -history -driverApp.passwordHash").lean()
      : [];
    const driversById = buildDriverMap(drivers);

    const rows = bookings.map((booking) => {
      const driver = driversById.get(String(booking.driverId || ""));
      const feesTotal = getFeesTotal(booking);
      const totalFare = getTripTotal(booking);
      return {
        bookingId: booking.bookingId || String(booking._id),
        documentId: String(booking._id),
        tripDate: dateOnly(booking.pickupTime),
        pickupTime: iso(booking.pickupTime),
        assignedAt: iso(booking.assignedAt),
        enRouteAt: iso(booking.enRouteAt),
        pickedUpAt: iso(booking.pickedUpAt),
        completedAt: iso(booking.completedAt || booking.tripSession?.completedAt),
        cancelledAt: iso(booking.cancelledAt),
        status: booking.status || "",
        tripSource: booking.tripSource === "driver" || booking.dispatchMethod === "flagdown" ? "Flagdown" : "Dispatch",
        dispatchMethod: booking.dispatchMethod || "",
        customerName: booking.customerName || "",
        phoneNumber: booking.phoneNumber || "",
        pickupAddress: booking.pickupAddress || "",
        dropoffAddress: booking.dropoffAddress || "",
        driverId: booking.driverId || "",
        driverName: driverDisplayName(driver),
        cabNumber: booking.cabNumber || "",
        passengers: booking.passengers || 0,
        wheelchairNeeded: Boolean(booking.wheelchairNeeded),
        estimatedDistanceMiles: round(booking.estimatedDistanceMiles),
        meterMiles: round(booking.meterMiles),
        waitMinutes: round(booking.waitMinutes),
        fareStrategy: booking.fareStrategy || "",
        estimatedFare: round(booking.estimatedFare),
        finalFare: round(booking.finalFare),
        feesTotal: round(feesTotal),
        totalFare: round(totalFare),
        noShowFeeApplied: Boolean(booking.noShowFeeApplied),
        cancelReason: booking.cancelReason || "",
        needsReassignment: Boolean(booking.needs_reassignment),
        syncStatus: booking.tripSession?.syncStatus || "",
        eventCount: booking.tripSession?.eventCount || 0,
        queueDepth: booking.tripSession?.queueDepth || 0,
      };
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalTrips += 1;
        if (row.status === "Completed") acc.completedTrips += 1;
        if (row.status === "Cancelled") acc.cancelledTrips += 1;
        if (row.status === "NoShow") acc.noShowTrips += 1;
        if (row.tripSource === "Flagdown") acc.flagdownTrips += 1;
        acc.totalFare = round(acc.totalFare + Number(row.totalFare || 0));
        acc.totalMiles = round(acc.totalMiles + Number(row.meterMiles || row.estimatedDistanceMiles || 0));
        return acc;
      },
      {
        totalTrips: 0,
        completedTrips: 0,
        cancelledTrips: 0,
        noShowTrips: 0,
        flagdownTrips: 0,
        totalFare: 0,
        totalMiles: 0,
      },
    );
    summary.averageFare = summary.totalTrips ? round(summary.totalFare / summary.totalTrips) : 0;

    return res.status(200).json({
      report: "trip-data",
      generatedAt: new Date().toISOString(),
      filters: { from: iso(from), to: iso(to), status, driverId, cabNumber, tripSource, dispatchMethod, dateField: selectedDateField },
      count: rows.length,
      summary,
      rows,
    });
  } catch (err) {
    console.error("Trip data report error", err);
    return res.status(500).json({ message: "Unable to run trip data report", error: String(err) });
  }
}

export async function hoursOfServiceReport(req, res) {
  try {
    const { driverId } = req.query || {};
    const { from, to } = parseDateRange(req.query, { defaultDays: 14 });
    const fromDateString = dateOnly(from);
    const toDateString = dateOnly(to || new Date());

    const hosQuery = {};
    if (driverId) hosQuery.driverId = String(driverId);
    if (fromDateString || toDateString) {
      hosQuery.date = {};
      if (fromDateString) hosQuery.date.$gte = fromDateString;
      if (toDateString) hosQuery.date.$lte = toDateString;
    }

    const dutyQuery = {};
    if (driverId) dutyQuery.driverId = String(driverId);
    if (from || to) {
      if (to) dutyQuery.startAt = { $lte: to };
      if (from) {
        dutyQuery.$or = [
          { endAt: { $gte: from } },
          { endAt: null },
          { endAt: { $exists: false } },
        ];
      }
    }

    const [hosAgg, duties, activeRows] = await Promise.all([
      DriverHOSModel.aggregate([
        { $match: hosQuery },
        {
          $group: {
            _id: { driverId: "$driverId", date: "$date" },
            minutes: { $sum: "$minutes" },
            entries: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": -1, "_id.driverId": 1 } },
      ]).allowDiskUse(true),
      DriverDutyModel.find(dutyQuery)
        .sort({ startAt: -1 })
        .limit(MAX_REPORT_LIMIT)
        .lean(),
      ActiveModel.find(driverId ? { driverId: String(driverId) } : {})
        .select("driverId firstName lastName cabNumber hoursOfService")
        .lean(),
    ]);

    const driverIds = new Set();
    hosAgg.forEach((row) => driverIds.add(String(row._id.driverId)));
    duties.forEach((row) => driverIds.add(String(row.driverId)));
    activeRows.forEach((row) => driverIds.add(String(row.driverId)));

    const drivers = driverIds.size
      ? await DriverModel.find({ driverId: { $in: [...driverIds] } }).select("-ssn -history -driverApp.passwordHash").lean()
      : [];
    const driversById = buildDriverMap(drivers);
    const activeByDriverId = new Map(activeRows.map((row) => [String(row.driverId), row]));
    const rowsByKey = new Map();

    const ensureRow = (id, date) => {
      const key = `${id}:${date}`;
      if (!rowsByKey.has(key)) {
        const driver = driversById.get(String(id));
        const active = activeByDriverId.get(String(id));
        rowsByKey.set(key, {
          driverId: String(id),
          driverName: driverDisplayName(driver) || [active?.firstName, active?.lastName].filter(Boolean).join(" ").trim(),
          cabNumber: active?.cabNumber || "",
          date,
          onDutyMinutes: 0,
          onDutyHours: 0,
          entryCount: 0,
          dutySessions: 0,
          firstStart: "",
          lastEnd: "",
          currentlyOnDuty: false,
          openDutyStart: "",
          violations: 0,
          violationNotes: "",
        });
      }
      return rowsByKey.get(key);
    };

    hosAgg.forEach((item) => {
      const row = ensureRow(item._id.driverId, item._id.date);
      row.onDutyMinutes += Number(item.minutes || 0);
      row.onDutyHours = round(row.onDutyMinutes / 60);
      row.entryCount += Number(item.entries || 0);
    });

    duties.forEach((duty) => {
      const dutyDate = dateOnly(duty.startAt);
      if (!dutyDate) return;
      const row = ensureRow(duty.driverId, dutyDate);
      row.dutySessions += 1;
      const startIso = iso(duty.startAt);
      const endIso = iso(duty.endAt);
      if (!row.firstStart || startIso < row.firstStart) row.firstStart = startIso;
      if (endIso && (!row.lastEnd || endIso > row.lastEnd)) row.lastEnd = endIso;
      if (!duty.endAt) {
        row.currentlyOnDuty = true;
        row.openDutyStart = startIso;
      }
      if (!row.onDutyMinutes) {
        row.onDutyMinutes = minutesBetween(duty.startAt, duty.endAt);
        row.onDutyHours = round(row.onDutyMinutes / 60);
      }
    });

    activeRows.forEach((active) => {
      const violations = Array.isArray(active.hoursOfService?.violations)
        ? active.hoursOfService.violations.filter((violation) => {
            const occurred = safeDate(violation?.occurredAt);
            if (!occurred) return false;
            if (from && occurred < from) return false;
            if (to && occurred > to) return false;
            return true;
          })
        : [];

      if (!violations.length && !active.hoursOfService?.dutyStart) return;

      const rowDate = dateOnly(active.hoursOfService?.dutyStart || new Date());
      const row = ensureRow(active.driverId, rowDate);
      if (active.hoursOfService?.dutyStart) {
        row.currentlyOnDuty = true;
        row.openDutyStart = iso(active.hoursOfService.dutyStart);
      }
      row.violations += violations.length;
      row.violationNotes = violations
        .map((violation) => [violation.rule, violation.note].filter(Boolean).join(": "))
        .filter(Boolean)
        .join(" | ");
    });

    const rows = [...rowsByKey.values()]
      .map((row) => ({
        ...row,
        onDutyHours: round(row.onDutyMinutes / 60),
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.driverId.localeCompare(b.driverId))
      .slice(0, toFiniteLimit(req.query?.limit, MAX_REPORT_LIMIT));

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalRows += 1;
        acc.totalOnDutyHours = round(acc.totalOnDutyHours + row.onDutyHours);
        acc.violations += Number(row.violations || 0);
        if (row.currentlyOnDuty) acc.openDuty += 1;
        acc.driverIds.add(row.driverId);
        return acc;
      },
      { totalRows: 0, totalOnDutyHours: 0, violations: 0, openDuty: 0, driverIds: new Set() },
    );

    return res.status(200).json({
      report: "hours-of-service",
      generatedAt: new Date().toISOString(),
      filters: { from: fromDateString, to: toDateString, driverId },
      count: rows.length,
      summary: {
        totalRows: summary.totalRows,
        totalOnDutyHours: summary.totalOnDutyHours,
        violations: summary.violations,
        openDuty: summary.openDuty,
        drivers: summary.driverIds.size,
      },
      rows,
    });
  } catch (err) {
    console.error("Hours of service report error", err);
    return res.status(500).json({ message: "Unable to run hours of service report", error: String(err) });
  }
}

export async function driverComplianceReport(req, res) {
  try {
    const dueWithinRaw = Number(req.query?.dueWithin || EXPIRY_WARNING_DAYS);
    const dueWithin = Number.isFinite(dueWithinRaw) ? Math.max(1, dueWithinRaw) : EXPIRY_WARNING_DAYS;
    const drivers = await DriverModel.find().select("-ssn -history -driverApp.passwordHash").lean();

    const rows = drivers.map((driver) => {
      const checks = [
        { key: "dlExpiry", label: "Driver license", value: driver.dlExpiry },
        { key: "dotExpiry", label: "DOT medical", value: driver.dotExpiry },
        { key: "cbiExpiry", label: "CBI", value: driver.cbiExpiry },
        { key: "mvrExpiry", label: "MVR", value: driver.mvrExpiry },
        { key: "fingerPrintsExpiry", label: "Fingerprints", value: driver.fingerPrintsExpiry },
      ].map((check) => ({ ...check, ...expiryStatus(check.value, dueWithin) }));
      const status = worstComplianceStatus(checks.map((check) => check.status));
      const next = checks
        .filter((check) => Number.isFinite(check.daysRemaining))
        .sort((a, b) => a.daysRemaining - b.daysRemaining)[0];

      return {
        driverId: driver.driverId || String(driver._id),
        driverName: driverDisplayName(driver),
        email: driver.email || "",
        phoneNumber: driver.phoneNumber || "",
        dlNumber: driver.dlNumber || "",
        dlExpiry: iso(driver.dlExpiry),
        dotExpiry: iso(driver.dotExpiry),
        cbiExpiry: iso(driver.cbiExpiry),
        mvrExpiry: iso(driver.mvrExpiry),
        fingerPrintsExpiry: iso(driver.fingerPrintsExpiry),
        nextExpiryType: next?.label || "",
        nextExpiryDate: iso(next?.value),
        daysToNextExpiry: next?.daysRemaining ?? "",
        complianceStatus: status,
        complianceLabel: complianceLabel(status),
      };
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalDrivers += 1;
        if (row.complianceStatus === "expired") acc.expired += 1;
        else if (row.complianceStatus === "dueSoon") acc.dueSoon += 1;
        else if (row.complianceStatus === "missing") acc.missing += 1;
        else acc.compliant += 1;
        return acc;
      },
      { totalDrivers: 0, compliant: 0, dueSoon: 0, expired: 0, missing: 0 },
    );

    return res.status(200).json({
      report: "driver-compliance",
      generatedAt: new Date().toISOString(),
      filters: { dueWithin },
      count: rows.length,
      summary,
      rows,
    });
  } catch (err) {
    console.error("Driver compliance report error", err);
    return res.status(500).json({ message: "Unable to run driver compliance report", error: String(err) });
  }
}

export async function vehicleComplianceReport(req, res) {
  try {
    const dueWithinRaw = Number(req.query?.dueWithin || EXPIRY_WARNING_DAYS);
    const dueWithin = Number.isFinite(dueWithinRaw) ? Math.max(1, dueWithinRaw) : EXPIRY_WARNING_DAYS;
    const vehicles = await VehicleModel.find().lean();

    const rows = vehicles.map((vehicle) => {
      const checks = [
        { key: "regisExpiry", label: "Registration", value: vehicle.regisExpiry },
        { key: "annualInspection", label: "Annual inspection", value: vehicle.annualInspection },
      ].map((check) => ({ ...check, ...expiryStatus(check.value, dueWithin) }));
      const status = worstComplianceStatus(checks.map((check) => check.status));
      const next = checks
        .filter((check) => Number.isFinite(check.daysRemaining))
        .sort((a, b) => a.daysRemaining - b.daysRemaining)[0];

      return {
        cabNumber: vehicle.cabNumber || "",
        vinNumber: vehicle.vinNumber || "",
        licPlates: vehicle.licPlates || "",
        make: vehicle.make || "",
        model: vehicle.model || "",
        year: vehicle.year || "",
        color: vehicle.color || "",
        regisExpiry: iso(vehicle.regisExpiry),
        annualInspection: iso(vehicle.annualInspection),
        nextExpiryType: next?.label || "",
        nextExpiryDate: iso(next?.value),
        daysToNextExpiry: next?.daysRemaining ?? "",
        complianceStatus: status,
        complianceLabel: complianceLabel(status),
      };
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalVehicles += 1;
        if (row.complianceStatus === "expired") acc.expired += 1;
        else if (row.complianceStatus === "dueSoon") acc.dueSoon += 1;
        else if (row.complianceStatus === "missing") acc.missing += 1;
        else acc.compliant += 1;
        return acc;
      },
      { totalVehicles: 0, compliant: 0, dueSoon: 0, expired: 0, missing: 0 },
    );

    return res.status(200).json({
      report: "vehicle-compliance",
      generatedAt: new Date().toISOString(),
      filters: { dueWithin },
      count: rows.length,
      summary,
      rows,
    });
  } catch (err) {
    console.error("Vehicle compliance report error", err);
    return res.status(500).json({ message: "Unable to run vehicle compliance report", error: String(err) });
  }
}

export async function incomePerDriver(req, res) {
  try {
    const { from, to, driverId } = req.query || {};
    let limit = Number(req.query?.limit || 100);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;

    const match = { status: "Completed" };
    if (from || to) {
      match.completedAt = {};
      const fromDate = parseDateBoundary(from, false);
      const toDate = parseDateBoundary(to, true);
      if (fromDate) match.completedAt.$gte = fromDate;
      if (toDate) match.completedAt.$lte = toDate;
      if (Object.keys(match.completedAt).length === 0) delete match.completedAt;
    }

    if (driverId) {
      match.driverId = String(driverId);
    }

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          __fareBase: {
            $ifNull: ["$finalFare", { $ifNull: ["$estimatedFare", "$flatRateAmount"] }],
          },
        },
      },
      {
        $addFields: {
          __feesTotal: {
            $reduce: {
              input: { $ifNull: ["$appliedFees", []] },
              initialValue: 0,
              in: { $add: ["$$value", { $ifNull: ["$$this.amount", 0] }] },
            },
          },
        },
      },
      {
        $addFields: {
          __totalFare: { $add: [{ $ifNull: ["$__fareBase", 0] }, { $ifNull: ["$__feesTotal", 0] }] },
        },
      },
      {
        $group: {
          _id: { $ifNull: ["$driverId", "unassigned"] },
          trips: { $sum: 1 },
          total: { $sum: "$__totalFare" },
          avg: { $avg: "$__totalFare" },
        },
      },
      {
        $lookup: {
          from: resolveModel("drivers").collection.name,
          localField: "_id",
          foreignField: "driverId",
          as: "__driver",
        },
      },
      { $unwind: { path: "$__driver", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          driverId: "$_id",
          driverName: {
            $let: {
              vars: {
                fullName: {
                  $trim: {
                    input: {
                      $concat: [
                        { $ifNull: ["$__driver.firstName", ""] },
                        " ",
                        { $ifNull: ["$__driver.lastName", ""] },
                      ],
                    },
                  },
                },
              },
              in: {
                $cond: [
                  { $gt: [{ $strLenCP: "$$fullName" }, 0] },
                  "$$fullName",
                  { $cond: [{ $eq: ["$_id", "unassigned"] }, "Unassigned", "$_id"] },
                ],
              },
            },
          },
          trips: 1,
          total: { $round: ["$total", 2] },
          avg: { $round: ["$avg", 2] },
        },
      },
      { $sort: { total: -1 } },
      { $limit: toFiniteLimit(limit, 100) },
    ];

    const results = await BookingModel.aggregate(pipeline).allowDiskUse(true).exec();
    const rows = results.map((row) => ({
      ...row,
      name: row.driverName,
      totalFare: row.total,
      averageFare: row.avg,
    }));
    const summary = rows.reduce(
      (acc, row) => {
        acc.totalDrivers += 1;
        acc.totalTrips += Number(row.trips || 0);
        acc.totalRevenue = round(acc.totalRevenue + Number(row.total || 0));
        return acc;
      },
      { totalDrivers: 0, totalTrips: 0, totalRevenue: 0 },
    );
    summary.avgFare = summary.totalTrips ? round(summary.totalRevenue / summary.totalTrips) : 0;

    return res.json({
      report: "income-per-driver",
      generatedAt: new Date().toISOString(),
      filters: { from, to, driverId },
      count: rows.length,
      summary,
      rows,
      data: rows,
    });
  } catch (err) {
    console.error("Income-per-driver report error", err);
    return res.status(500).json({ message: "Unable to run income-per-driver report", error: String(err) });
  }
}

export default {
  queryReports,
  tripDataReport,
  hoursOfServiceReport,
  driverComplianceReport,
  vehicleComplianceReport,
  incomePerDriver,
};
