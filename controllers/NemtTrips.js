import NemtAgencyModel from "../models/NemtAgencySchema.js";
import NemtTripModel from "../models/NemtTripSchema.js";
import NemtRunModel from "../models/NemtRunSchema.js";
import { NEMT_SETTINGS_ID, NemtSettingsModel } from "../models/NemtSettingsSchema.js";
import { toAdminNemtTripPayload } from "../realtime/nemtPayloads.js";
import { emitToAdmins, emitToDriver } from "../realtime/index.js";
import { geocodeAddress } from "../utils/mapbox.js";
import { saveWithIdRetry } from "../utils/saveWithRetry.js";
import { parseImportFile } from "../services/nemtImport.js";

const TERMINAL_STATUSES = new Set([
  "Completed",
  "Cancelled",
  "NoShow",
  "PassengerCancelled",
]);

// Auto-calculate driverPay from agencyFare + settings when not explicitly supplied.
// defaultPayPercentage = company's deduction %; driver receives (100 - X)% of agencyFare.
function applyDefaultPay(data, settings) {
  if (data.driverPay != null || !data.agencyFare || !settings) return;
  const basis = settings.defaultPayBasis || "per_trip";
  if (basis === "percentage" && settings.defaultPayPercentage > 0) {
    const driverFraction = (100 - settings.defaultPayPercentage) / 100;
    data.driverPay = parseFloat((data.agencyFare * driverFraction).toFixed(2));
  } else if (basis === "per_trip" && settings.defaultPayRatePerTrip > 0) {
    data.driverPay = settings.defaultPayRatePerTrip;
  }
  // per_mile is deferred to trip completion when actualMiles are known
}

async function geocodeTripIfNeeded(data) {
  if (!data.pickupLon && !data.pickupLat && data.pickupAddress) {
    try {
      const geo = await geocodeAddress(data.pickupAddress);
      if (geo) { data.pickupLon = geo.lon; data.pickupLat = geo.lat; }
    } catch (_) {}
  }
  if (!data.dropoffLon && !data.dropoffLat && data.dropoffAddress) {
    try {
      const geo = await geocodeAddress(data.dropoffAddress);
      if (geo) { data.dropoffLon = geo.lon; data.dropoffLat = geo.lat; }
    } catch (_) {}
  }
}

export async function listTrips(req, res) {
  const { serviceDate, status, agencyId, runId, driverId, page = "1", limit = "50" } = req.query;
  const filter = {};

  if (serviceDate) {
    const day = new Date(serviceDate);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    filter.serviceDate = { $gte: day, $lt: next };
  }
  if (status) {
    filter.status = { $in: Array.isArray(status) ? status : status.split(",") };
  }
  if (agencyId) filter.agencyId = agencyId;
  if (runId === "none") {
    filter.runId = null;
  } else if (runId) {
    filter.runId = runId;
  }
  if (driverId) filter.driverId = driverId;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [trips, total] = await Promise.all([
    NemtTripModel.find(filter)
      .sort({ serviceDate: 1, scheduledPickupTime: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    NemtTripModel.countDocuments(filter),
  ]);

  return res.status(200).json({
    trips: trips.map(toAdminNemtTripPayload),
    total,
    page: pageNum,
    limit: limitNum,
  });
}

export async function createTrip(req, res) {
  const data = { ...req.body };
  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  applyDefaultPay(data, settings);
  await geocodeTripIfNeeded(data);
  const trip = new NemtTripModel(data);
  await saveWithIdRetry(() => trip.save(), ["tripId"]);
  emitToAdmins("nemt:trip-created", toAdminNemtTripPayload(trip));
  return res.status(201).json({ trip: toAdminNemtTripPayload(trip) });
}

export async function bulkCreateTrips(req, res) {
  const { trips: tripList } = req.body;
  const importBatchId = `BATCH-${Date.now()}`;
  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  const created = [];
  const errors = [];

  for (let i = 0; i < tripList.length; i++) {
    try {
      const data = { ...tripList[i], importBatchId };
      applyDefaultPay(data, settings);
      await geocodeTripIfNeeded(data);
      const trip = new NemtTripModel(data);
      await saveWithIdRetry(() => trip.save(), ["tripId"]);
      created.push(toAdminNemtTripPayload(trip));
    } catch (err) {
      errors.push({ index: i, message: err.message });
    }
  }

  if (created.length > 0) {
    emitToAdmins("nemt:trips-bulk-created", { importBatchId, count: created.length });
  }

  return res.status(201).json({ created: created.length, errors, importBatchId });
}

export async function importTrips(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded." });
  }

  const { agencyId, serviceDate } = req.body;
  if (!agencyId) return res.status(400).json({ message: "agencyId is required." });
  if (!serviceDate) return res.status(400).json({ message: "serviceDate is required." });

  const agency = await NemtAgencyModel.findById(agencyId).lean();
  if (!agency) return res.status(404).json({ message: "Agency not found." });

  const { rows, errors: parseErrors } = parseImportFile(req.file.buffer, req.file.mimetype);

  if (rows.length === 0) {
    return res.status(400).json({
      message: "No valid rows found in file.",
      errors: parseErrors,
    });
  }

  const importBatchId = `IMPORT-${Date.now()}`;
  const serviceDateObj = new Date(serviceDate);
  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  const created = [];
  const rowErrors = [];

  for (let i = 0; i < rows.length; i++) {
    const data = { ...rows[i], agencyId, serviceDate: serviceDateObj, importBatchId };
    applyDefaultPay(data, settings);
    if (!data.passengerName) { rowErrors.push({ row: i + 2, message: "Missing passenger name." }); continue; }
    if (!data.pickupAddress) { rowErrors.push({ row: i + 2, message: "Missing pickup address." }); continue; }
    if (!data.dropoffAddress) { rowErrors.push({ row: i + 2, message: "Missing dropoff address." }); continue; }
    if (!data.scheduledPickupTime) { rowErrors.push({ row: i + 2, message: "Missing scheduled pickup time." }); continue; }

    try {
      await geocodeTripIfNeeded(data);
      const trip = new NemtTripModel(data);
      await saveWithIdRetry(() => trip.save(), ["tripId"]);
      created.push(toAdminNemtTripPayload(trip));
    } catch (err) {
      rowErrors.push({ row: i + 2, message: err.message });
    }
  }

  if (created.length > 0) {
    emitToAdmins("nemt:trips-imported", { importBatchId, count: created.length, agencyId });
  }

  return res.status(201).json({
    created: created.length,
    skipped: rowErrors.length,
    errors: [...parseErrors, ...rowErrors],
    importBatchId,
  });
}

export async function getTripById(req, res) {
  const trip = await NemtTripModel.findById(req.params.id).lean();
  if (!trip) return res.status(404).json({ message: "Trip not found." });
  return res.status(200).json({ trip: toAdminNemtTripPayload(trip) });
}

export async function updateTrip(req, res) {
  const trip = await NemtTripModel.findById(req.params.id);
  if (!trip) return res.status(404).json({ message: "Trip not found." });
  if (TERMINAL_STATUSES.has(trip.status)) {
    return res.status(409).json({ message: `Cannot edit a trip in terminal status '${trip.status}'.` });
  }

  const { history, tripId, agencyId, serviceDate, ...updates } = req.body;
  Object.assign(trip, updates);
  await trip.save();

  emitToAdmins("nemt:trip-updated", toAdminNemtTripPayload(trip));
  if (trip.driverId) {
    emitToDriver(trip.driverId, "nemt:trip-updated", {
      tripId: trip.tripId,
      runId: trip.runId?.toString(),
      message: "A trip on your manifest was updated.",
    });
  }

  return res.status(200).json({ trip: toAdminNemtTripPayload(trip) });
}

export async function cancelTrip(req, res) {
  const { cancelledBy, cancelReason } = req.body;
  const trip = await NemtTripModel.findById(req.params.id);
  if (!trip) return res.status(404).json({ message: "Trip not found." });
  if (TERMINAL_STATUSES.has(trip.status)) {
    return res.status(409).json({ message: `Trip is already in terminal status '${trip.status}'.` });
  }

  const prevStatus = trip.status;
  trip.status = "Cancelled";
  trip.cancelledBy = cancelledBy;
  trip.cancelReason = cancelReason;
  trip.cancelledAt = new Date();
  trip.history.push({
    action: "cancel",
    byUserId: req.admin?.id,
    before: { status: prevStatus },
    after: { status: "Cancelled" },
    note: cancelReason,
  });
  await trip.save();

  if (trip.runId) {
    await NemtRunModel.updateOne({ _id: trip.runId }, { $inc: { cancelledCount: 1 } });
  }

  emitToAdmins("nemt:trip-cancelled", toAdminNemtTripPayload(trip));
  if (trip.driverId) {
    emitToDriver(trip.driverId, "nemt:trip-cancelled", {
      tripId: trip.tripId,
      runId: trip.runId?.toString(),
      message: `Trip ${trip.tripId} cancelled by dispatch.`,
    });
  }

  return res.status(200).json({ trip: toAdminNemtTripPayload(trip) });
}

export async function markNoShow(req, res) {
  const { noShowReason } = req.body;
  const trip = await NemtTripModel.findById(req.params.id);
  if (!trip) return res.status(404).json({ message: "Trip not found." });
  if (TERMINAL_STATUSES.has(trip.status)) {
    return res.status(409).json({ message: `Trip is already in terminal status '${trip.status}'.` });
  }

  const prevStatus = trip.status;
  trip.status = "NoShow";
  trip.noShowReason = noShowReason;
  trip.noShowAt = new Date();
  trip.history.push({
    action: "no_show",
    byUserId: req.admin?.id,
    before: { status: prevStatus },
    after: { status: "NoShow" },
    note: noShowReason,
  });
  await trip.save();

  if (trip.runId) {
    await NemtRunModel.updateOne({ _id: trip.runId }, { $inc: { noShowCount: 1 } });
  }

  emitToAdmins("nemt:trip-no-show", toAdminNemtTripPayload(trip));
  if (trip.driverId) {
    emitToDriver(trip.driverId, "nemt:trip-no-show", {
      tripId: trip.tripId,
      runId: trip.runId?.toString(),
    });
  }

  return res.status(200).json({ trip: toAdminNemtTripPayload(trip) });
}
