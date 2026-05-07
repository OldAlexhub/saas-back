import NemtAgencyModel from "../models/NemtAgencySchema.js";
import NemtImportBatchModel from "../models/NemtImportBatchSchema.js";
import NemtTripModel from "../models/NemtTripSchema.js";
import { NEMT_SETTINGS_ID, NemtSettingsModel } from "../models/NemtSettingsSchema.js";
import { toAdminNemtTripPayload } from "../realtime/nemtPayloads.js";
import { emitToAdmins } from "../realtime/index.js";
import { parseImportFile } from "../services/nemtImport.js";
import { geocodeAddress } from "../utils/mapbox.js";
import { saveWithIdRetry } from "../utils/saveWithRetry.js";

function startOfUtcDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function nextUtcDay(value) {
  const date = startOfUtcDay(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function combineWithServiceDate(value, serviceDate) {
  if (value == null || value === "") return undefined;
  const base = startOfUtcDay(serviceDate);
  if (!base) return undefined;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    hours = value.getHours();
    minutes = value.getMinutes();
    seconds = value.getSeconds();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    const fraction = value >= 1 ? value % 1 : value;
    const totalSeconds = Math.round(fraction * 24 * 60 * 60);
    hours = Math.floor(totalSeconds / 3600);
    minutes = Math.floor((totalSeconds % 3600) / 60);
    seconds = totalSeconds % 60;
  } else {
    const raw = String(value).trim();
    const timeOnly = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i);
    if (timeOnly) {
      hours = Number(timeOnly[1]);
      minutes = Number(timeOnly[2] || 0);
      seconds = Number(timeOnly[3] || 0);
      const meridiem = timeOnly[4]?.toLowerCase();
      if (meridiem === "pm" && hours < 12) hours += 12;
      if (meridiem === "am" && hours === 12) hours = 0;
    } else {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return undefined;
      hours = parsed.getHours();
      minutes = parsed.getMinutes();
      seconds = parsed.getSeconds();
    }
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return undefined;
  }

  return new Date(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hours, minutes, seconds, 0);
}

function applyDefaultPay(data, settings) {
  if (data.driverPay != null || !data.agencyFare || !settings) return;
  const basis = settings.defaultPayBasis || "per_trip";
  if (basis === "percentage" && settings.defaultPayPercentage > 0) {
    const driverFraction = (100 - settings.defaultPayPercentage) / 100;
    data.driverPay = parseFloat((data.agencyFare * driverFraction).toFixed(2));
  } else if (basis === "per_trip" && settings.defaultPayRatePerTrip > 0) {
    data.driverPay = settings.defaultPayRatePerTrip;
  }
}

function applyDefaultPickupWindow(data, settings) {
  if (!data.scheduledPickupTime) return;
  const pickupTime = new Date(data.scheduledPickupTime);
  if (Number.isNaN(pickupTime.getTime())) return;
  const before = Number(settings?.defaultPickupWindowMinutesBefore ?? 15);
  const after = Number(settings?.defaultPickupWindowMinutesAfter ?? 30);
  if (!data.pickupWindowEarliest) {
    data.pickupWindowEarliest = new Date(pickupTime.getTime() - before * 60_000);
  }
  if (!data.pickupWindowLatest) {
    data.pickupWindowLatest = new Date(pickupTime.getTime() + after * 60_000);
  }
}

async function geocodeTripIfNeeded(data) {
  if (!data.pickupLon && !data.pickupLat && data.pickupAddress) {
    const geo = await geocodeAddress(data.pickupAddress).catch(() => null);
    if (geo) { data.pickupLon = geo.lon; data.pickupLat = geo.lat; }
  }
  if (!data.dropoffLon && !data.dropoffLat && data.dropoffAddress) {
    const geo = await geocodeAddress(data.dropoffAddress).catch(() => null);
    if (geo) { data.dropoffLon = geo.lon; data.dropoffLat = geo.lat; }
  }
}

async function validateRowData(data, { agencyId, serviceDate, settings, seenRefs }) {
  const day = startOfUtcDay(serviceDate);
  const next = nextUtcDay(serviceDate);
  const normalized = { ...data, agencyId, serviceDate: day };
  const errors = [];
  const warnings = [];

  normalized.scheduledPickupTime = combineWithServiceDate(normalized.scheduledPickupTime, day);
  normalized.appointmentTime = combineWithServiceDate(normalized.appointmentTime, day);
  normalized.pickupWindowEarliest = combineWithServiceDate(normalized.pickupWindowEarliest, day);
  normalized.pickupWindowLatest = combineWithServiceDate(normalized.pickupWindowLatest, day);
  applyDefaultPay(normalized, settings);
  applyDefaultPickupWindow(normalized, settings);

  if (!normalized.passengerName) errors.push("Missing passenger name.");
  if (!normalized.pickupAddress) errors.push("Missing pickup address.");
  if (!normalized.dropoffAddress) errors.push("Missing dropoff address.");
  if (!normalized.scheduledPickupTime) errors.push("Missing or invalid scheduled pickup time.");
  if (!normalized.passengerPhone) warnings.push("Passenger phone is missing.");
  if (!normalized.agencyTripRef) warnings.push("Agency trip reference is missing; duplicate detection is weaker.");

  if (normalized.agencyTripRef && day && next) {
    const refKey = String(normalized.agencyTripRef).trim().toLowerCase();
    if (seenRefs.has(refKey)) {
      errors.push(`Duplicate trip ref '${normalized.agencyTripRef}' in this file.`);
    } else {
      seenRefs.add(refKey);
      const existing = await NemtTripModel.findOne({
        agencyId,
        agencyTripRef: normalized.agencyTripRef,
        serviceDate: { $gte: day, $lt: next },
      }).select("_id tripId").lean();
      if (existing) {
        errors.push(`Duplicate agency trip ref '${normalized.agencyTripRef}' already exists as trip #${existing.tripId}.`);
      }
    }
  }

  return {
    status: errors.length ? "error" : warnings.length ? "warning" : "valid",
    data: normalized,
    errors,
    warnings,
  };
}

async function normalizeStageRow(row, context) {
  return validateRowData(row, context);
}

function batchPayload(batch) {
  const plain = typeof batch.toObject === "function" ? batch.toObject() : batch;
  return {
    id: plain._id?.toString?.() || plain._id,
    batchId: plain.batchId,
    agencyId: plain.agencyId,
    serviceDate: plain.serviceDate,
    status: plain.status,
    sourceFileName: plain.sourceFileName,
    totalRows: plain.totalRows,
    validRows: plain.validRows,
    warningRows: plain.warningRows,
    errorRows: plain.errorRows,
    importedRows: plain.importedRows,
    skippedRows: plain.skippedRows,
    rows: plain.rows || [],
    createdAt: plain.createdAt,
    committedAt: plain.committedAt,
    cancelledAt: plain.cancelledAt,
    rolledBackAt: plain.rolledBackAt,
  };
}

export async function stageImport(req, res) {
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });
  const { agencyId, serviceDate } = req.body;
  if (!agencyId) return res.status(400).json({ message: "agencyId is required." });
  if (!serviceDate) return res.status(400).json({ message: "serviceDate is required." });

  const day = startOfUtcDay(serviceDate);
  if (!day) return res.status(400).json({ message: "serviceDate is invalid." });

  const agency = await NemtAgencyModel.findOne({ agencyId }).lean();
  if (!agency) return res.status(404).json({ message: "Agency not found." });

  const parsed = parseImportFile(req.file.buffer, req.file.mimetype);
  if (!parsed.rows.length) {
    return res.status(400).json({ message: "No valid rows found in file.", errors: parsed.errors });
  }

  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  const seenRefs = new Set();
  const stagedRows = [];

  for (let i = 0; i < parsed.rows.length; i += 1) {
    const staged = await normalizeStageRow(parsed.rows[i], {
      agencyId,
      serviceDate: day,
      settings,
      seenRefs,
    });
    stagedRows.push({
      rowNumber: i + 2,
      ...staged,
      errors: [...(parsed.errors[i] ? [parsed.errors[i]] : []), ...staged.errors],
    });
  }

  const batch = new NemtImportBatchModel({
    agencyId,
    serviceDate: day,
    sourceFileName: req.file.originalname,
    sourceMimeType: req.file.mimetype,
    rows: stagedRows,
  });
  await batch.save();

  emitToAdmins("nemt:import-staged", {
    batchId: batch.batchId,
    id: batch._id.toString(),
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    warningRows: batch.warningRows,
    errorRows: batch.errorRows,
  });

  return res.status(201).json({ batch: batchPayload(batch) });
}

export async function getImportBatch(req, res) {
  const batch = await NemtImportBatchModel.findById(req.params.id).lean();
  if (!batch) return res.status(404).json({ message: "Import batch not found." });
  return res.status(200).json({ batch: batchPayload(batch) });
}

// PATCH /nemt/imports/:id/rows/:rowNumber — correct data in a staged row and re-validate
export async function correctImportRow(req, res) {
  const batch = await NemtImportBatchModel.findById(req.params.id);
  if (!batch) return res.status(404).json({ message: "Import batch not found." });
  if (batch.status !== "staged") {
    return res.status(409).json({ message: `Cannot correct rows in a batch with status '${batch.status}'.` });
  }

  const rowNumber = Number(req.params.rowNumber);
  const row = batch.rows.find((r) => r.rowNumber === rowNumber);
  if (!row) return res.status(404).json({ message: `Row ${rowNumber} not found in this batch.` });
  if (["imported", "skipped"].includes(row.status)) {
    return res.status(409).json({ message: `Row ${rowNumber} is already '${row.status}' and cannot be corrected.` });
  }

  const { data: newData, correctionNote } = req.body;
  const mergedData = { ...row.data, ...newData };

  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();

  // Re-validate this row in isolation (seenRefs excludes other rows in same batch)
  const otherBatchRefs = new Set(
    batch.rows
      .filter((r) => r.rowNumber !== rowNumber && r.data?.agencyTripRef)
      .map((r) => String(r.data.agencyTripRef).trim().toLowerCase())
  );

  const validated = await validateRowData(mergedData, {
    agencyId: batch.agencyId,
    serviceDate: batch.serviceDate,
    settings,
    seenRefs: otherBatchRefs,
  });

  row.data = validated.data;
  row.status = validated.status;
  row.errors = validated.errors;
  row.warnings = validated.warnings;
  row.correctedAt = new Date();
  if (correctionNote) row.correctionNote = correctionNote;

  batch.markModified("rows");
  await batch.save();

  emitToAdmins("nemt:import-row-corrected", {
    batchId: batch.batchId,
    id: batch._id.toString(),
    rowNumber,
    newStatus: row.status,
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    warningRows: batch.warningRows,
    errorRows: batch.errorRows,
  });

  return res.status(200).json({ batch: batchPayload(batch) });
}

// POST /nemt/imports/:id/cancel — cancel a staged batch without importing anything
export async function cancelImportBatch(req, res) {
  const batch = await NemtImportBatchModel.findById(req.params.id);
  if (!batch) return res.status(404).json({ message: "Import batch not found." });
  if (batch.status !== "staged") {
    return res.status(409).json({ message: `Cannot cancel a batch with status '${batch.status}'.` });
  }

  batch.status = "cancelled";
  batch.cancelledAt = new Date();
  batch.cancelledBy = req.user?.id || req.user?.email || "system";
  await batch.save();

  emitToAdmins("nemt:import-cancelled", {
    batchId: batch.batchId,
    id: batch._id.toString(),
  });

  return res.status(200).json({ batch: batchPayload(batch) });
}

// POST /nemt/imports/:id/rollback — delete trips created by this batch and mark it rolled back
export async function rollbackImportBatch(req, res) {
  const batch = await NemtImportBatchModel.findById(req.params.id);
  if (!batch) return res.status(404).json({ message: "Import batch not found." });
  if (!["committed", "partially_committed"].includes(batch.status)) {
    return res.status(409).json({
      message: `Only committed or partially_committed batches can be rolled back. Current status: '${batch.status}'.`,
    });
  }

  // Collect trip IDs created by this batch
  const importedRows = batch.rows.filter((r) => r.status === "imported" && r.createdTripId);

  // Block rollback if any created trip has already started (EnRoute or beyond)
  const startedTrips = await NemtTripModel.find({
    _id: { $in: importedRows.map((r) => r.createdTripId) },
    status: { $in: ["EnRoute", "ArrivedPickup", "PickedUp", "ArrivedDrop", "Completed"] },
  }).select("tripId status").lean();

  if (startedTrips.length) {
    const ids = startedTrips.map((t) => `#${t.tripId} (${t.status})`).join(", ");
    return res.status(409).json({
      message: `Rollback blocked: ${startedTrips.length} trip(s) have already started: ${ids}.`,
    });
  }

  // Delete the trips that were created and haven't started
  const deletableIds = importedRows.map((r) => r.createdTripId);
  await NemtTripModel.deleteMany({ _id: { $in: deletableIds } });

  // Reset row statuses back to their pre-import state
  for (const row of batch.rows) {
    if (row.status === "imported") {
      row.status = "valid";
      row.createdTripId = undefined;
      row.createdTripNumber = undefined;
    }
  }

  batch.status = "cancelled";
  batch.rolledBackAt = new Date();
  batch.rolledBackBy = req.user?.id || req.user?.email || "system";
  batch.markModified("rows");
  await batch.save();

  emitToAdmins("nemt:import-rolled-back", {
    batchId: batch.batchId,
    id: batch._id.toString(),
    deletedCount: deletableIds.length,
  });

  return res.status(200).json({
    batch: batchPayload(batch),
    deletedTripCount: deletableIds.length,
  });
}

// POST /nemt/imports/:id/commit
// Body: { allowWarnings?: boolean }
// Warning rows are only committed when allowWarnings=true is explicitly sent.
export async function commitImportBatch(req, res) {
  const batch = await NemtImportBatchModel.findById(req.params.id);
  if (!batch) return res.status(404).json({ message: "Import batch not found." });
  if (batch.status !== "staged") {
    return res.status(409).json({ message: `Import batch is already ${batch.status}.` });
  }

  const allowWarnings = req.body?.allowWarnings === true;

  const created = [];
  for (const row of batch.rows) {
    const eligible = row.status === "valid" || (row.status === "warning" && allowWarnings);
    if (!eligible) {
      row.status = "skipped";
      continue;
    }
    try {
      const data = { ...row.data, importBatchId: batch.batchId };
      await geocodeTripIfNeeded(data);
      const trip = new NemtTripModel(data);
      await saveWithIdRetry(() => trip.save(), ["tripId"]);
      row.status = "imported";
      row.createdTripId = trip._id;
      row.createdTripNumber = trip.tripId;
      created.push(toAdminNemtTripPayload(trip));
    } catch (err) {
      row.status = "error";
      row.errors = [...(row.errors || []), err.message || "Failed to import row."];
    }
  }

  batch.status = created.length && batch.rows.some((r) => r.status === "error")
    ? "partially_committed"
    : "committed";
  batch.committedAt = new Date();
  batch.committedBy = req.user?.id || req.user?.email || "system";
  batch.markModified("rows");
  await batch.save();

  emitToAdmins("nemt:trips-imported", {
    importBatchId: batch.batchId,
    count: created.length,
    agencyId: batch.agencyId,
  });

  return res.status(201).json({
    batch: batchPayload(batch),
    created: created.length,
    skippedWarnings: !allowWarnings ? batch.rows.filter((r) => r.status === "skipped").length : 0,
    trips: created,
  });
}
