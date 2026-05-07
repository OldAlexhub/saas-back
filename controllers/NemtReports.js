import NemtTripModel from "../models/NemtTripSchema.js";
import NemtRunModel from "../models/NemtRunSchema.js";
import NemtImportBatchModel from "../models/NemtImportBatchSchema.js";
import NemtPaymentBatchModel from "../models/NemtPaymentBatchSchema.js";
import { NEMT_SETTINGS_ID, NemtSettingsModel } from "../models/NemtSettingsSchema.js";

const MAX_ROWS = 5000;

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

function parseDateRange(query = {}, defaultDays = 30) {
  let from = parseDateBoundary(query.from, false);
  let to = parseDateBoundary(query.to, true);
  if (!from && !to) {
    to = new Date();
    from = new Date(to.getTime() - (defaultDays - 1) * 24 * 60 * 60 * 1000);
    from.setUTCHours(0, 0, 0, 0);
  }
  return { from, to };
}

function classifyOtp(diffMin, settings) {
  if (diffMin == null || !Number.isFinite(diffMin)) return "no_data";
  const onTimeMax = settings?.otpOnTimeMaxMinutes ?? 15;
  const lateMax = settings?.otpLateMaxMinutes ?? 30;
  if (diffMin < 0) return "early";
  if (diffMin <= onTimeMax) return "on_time";
  if (diffMin <= lateMax) return "late";
  return "very_late";
}

// GET /nemt/reports/otp
export async function otpReport(req, res) {
  const { from, to } = parseDateRange(req.query, 30);
  const { agencyId } = req.query;

  const filter = { status: { $in: ["Completed", "NoShow"] } };
  if (from) filter.serviceDate = { ...filter.serviceDate, $gte: from };
  if (to) filter.serviceDate = { ...filter.serviceDate, $lte: to };
  if (agencyId) filter.agencyId = agencyId;

  const [trips, settings] = await Promise.all([
    NemtTripModel.find(filter)
      .select("agencyId serviceDate otpStatus scheduledVsActualMinutes status passengerName scheduledPickupTime pickedUpAt")
      .lean(),
    NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean(),
  ]);

  // Tally per-day OTP buckets
  const dayMap = new Map();
  const agencyMap = new Map();

  for (const t of trips) {
    if (t.status !== "Completed") continue;
    const otp = classifyOtp(t.scheduledVsActualMinutes, settings);
    const day = t.serviceDate ? new Date(t.serviceDate).toISOString().substring(0, 10) : "unknown";

    // Day buckets
    if (!dayMap.has(day)) dayMap.set(day, { date: day, total: 0, early: 0, on_time: 0, late: 0, very_late: 0, no_data: 0 });
    const d = dayMap.get(day);
    d.total += 1;
    d[otp] = (d[otp] || 0) + 1;

    // Agency buckets
    if (t.agencyId) {
      if (!agencyMap.has(t.agencyId)) agencyMap.set(t.agencyId, { agencyId: t.agencyId, total: 0, early: 0, on_time: 0, late: 0, very_late: 0, no_data: 0 });
      const a = agencyMap.get(t.agencyId);
      a.total += 1;
      a[otp] = (a[otp] || 0) + 1;
    }
  }

  const totalCompleted = trips.filter((t) => t.status === "Completed").length;
  const overallBuckets = { early: 0, on_time: 0, late: 0, very_late: 0, no_data: 0 };
  for (const d of dayMap.values()) {
    for (const k of Object.keys(overallBuckets)) overallBuckets[k] += d[k] || 0;
  }

  const onTimePct = totalCompleted > 0
    ? (((overallBuckets.early + overallBuckets.on_time) / totalCompleted) * 100).toFixed(1)
    : null;

  return res.status(200).json({
    from: from?.toISOString(),
    to: to?.toISOString(),
    totalTrips: trips.length,
    totalCompleted,
    totalNoShow: trips.filter((t) => t.status === "NoShow").length,
    onTimePct,
    overall: overallBuckets,
    byDay: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byAgency: [...agencyMap.values()],
    settings: settings
      ? { otpOnTimeMaxMinutes: settings.otpOnTimeMaxMinutes, otpLateMaxMinutes: settings.otpLateMaxMinutes }
      : null,
  });
}

// GET /nemt/reports/trips
export async function tripSummaryReport(req, res) {
  const { from, to } = parseDateRange(req.query, 30);
  const { agencyId, driverId, status } = req.query;
  const limit = Math.min(Number(req.query.limit) || 1000, MAX_ROWS);

  const filter = {};
  if (from) filter.serviceDate = { ...filter.serviceDate, $gte: from };
  if (to) filter.serviceDate = { ...filter.serviceDate, $lte: to };
  if (agencyId) filter.agencyId = agencyId;
  if (driverId) filter.driverId = driverId;
  if (status && status !== "all") filter.status = status;

  const trips = await NemtTripModel.find(filter)
    .select(
      "tripId agencyId agencyTripRef serviceDate passengerName mobilityType status " +
      "pickupAddress dropoffAddress scheduledPickupTime appointmentTime " +
      "driverId cabNumber runId runSequence " +
      "enRouteAt arrivedPickupAt pickedUpAt arrivedDropAt completedAt cancelledAt noShowAt " +
      "scheduledVsActualMinutes otpStatus actualMiles " +
      "agencyFare agencyFareBasis billingStatus billedAt " +
      "driverPay payStatus paidAt " +
      "cancelReason noShowReason internalNotes createdAt"
    )
    .sort({ serviceDate: -1, scheduledPickupTime: 1 })
    .limit(limit)
    .lean();

  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();

  const rows = trips.map((t) => ({
    tripId: t.tripId,
    agencyId: t.agencyId,
    agencyTripRef: t.agencyTripRef,
    serviceDate: t.serviceDate ? new Date(t.serviceDate).toISOString().substring(0, 10) : null,
    passengerName: t.passengerName,
    mobilityType: t.mobilityType,
    status: t.status,
    pickupAddress: t.pickupAddress,
    dropoffAddress: t.dropoffAddress,
    scheduledPickupTime: t.scheduledPickupTime,
    appointmentTime: t.appointmentTime,
    driverId: t.driverId,
    cabNumber: t.cabNumber,
    runId: t.runId,
    runSequence: t.runSequence,
    enRouteAt: t.enRouteAt,
    arrivedPickupAt: t.arrivedPickupAt,
    pickedUpAt: t.pickedUpAt,
    arrivedDropAt: t.arrivedDropAt,
    completedAt: t.completedAt,
    cancelledAt: t.cancelledAt,
    noShowAt: t.noShowAt,
    scheduledVsActualMinutes: t.scheduledVsActualMinutes,
    otpStatus: t.status === "Completed" ? classifyOtp(t.scheduledVsActualMinutes, settings) : null,
    actualMiles: t.actualMiles,
    agencyFare: t.agencyFare,
    agencyFareBasis: t.agencyFareBasis,
    billingStatus: t.billingStatus,
    billedAt: t.billedAt,
    driverPay: t.driverPay,
    payStatus: t.payStatus,
    paidAt: t.paidAt,
    cancelReason: t.cancelReason,
    noShowReason: t.noShowReason,
    internalNotes: t.internalNotes,
    createdAt: t.createdAt,
  }));

  return res.status(200).json({
    from: from?.toISOString(),
    to: to?.toISOString(),
    count: rows.length,
    trips: rows,
  });
}

// GET /nemt/reports/driver-activity
export async function driverActivityReport(req, res) {
  const { from, to } = parseDateRange(req.query, 30);
  const { driverId } = req.query;

  const filter = { status: { $in: ["Completed", "NoShow", "Cancelled", "PassengerCancelled"] } };
  if (from) filter.serviceDate = { ...filter.serviceDate, $gte: from };
  if (to) filter.serviceDate = { ...filter.serviceDate, $lte: to };
  if (driverId) filter.driverId = driverId;

  const trips = await NemtTripModel.find(filter)
    .select("driverId status driverPay payStatus actualMiles serviceDate scheduledVsActualMinutes")
    .lean();

  const driverMap = new Map();
  for (const t of trips) {
    if (!t.driverId) continue;
    if (!driverMap.has(t.driverId)) {
      driverMap.set(t.driverId, {
        driverId: t.driverId,
        totalTrips: 0,
        completed: 0,
        noShow: 0,
        cancelled: 0,
        totalPay: 0,
        paidPay: 0,
        unpaidPay: 0,
        totalMiles: 0,
        otpSumMinutes: 0,
        otpCount: 0,
      });
    }
    const d = driverMap.get(t.driverId);
    d.totalTrips += 1;
    if (t.status === "Completed") d.completed += 1;
    else if (t.status === "NoShow") d.noShow += 1;
    else d.cancelled += 1;

    if (t.driverPay) {
      d.totalPay += t.driverPay;
      if (t.payStatus === "paid") d.paidPay += t.driverPay;
      else d.unpaidPay += t.driverPay;
    }
    if (t.actualMiles) d.totalMiles += t.actualMiles;
    if (t.status === "Completed" && t.scheduledVsActualMinutes != null) {
      d.otpSumMinutes += t.scheduledVsActualMinutes;
      d.otpCount += 1;
    }
  }

  const rows = [...driverMap.values()].map((d) => ({
    ...d,
    completionRate: d.totalTrips > 0 ? ((d.completed / d.totalTrips) * 100).toFixed(1) : null,
    avgPickupDelayMinutes: d.otpCount > 0 ? Math.round(d.otpSumMinutes / d.otpCount) : null,
  })).sort((a, b) => b.totalTrips - a.totalTrips);

  return res.status(200).json({
    from: from?.toISOString(),
    to: to?.toISOString(),
    driverCount: rows.length,
    drivers: rows,
  });
}

// GET /nemt/reports/agency-billing
export async function agencyBillingReport(req, res) {
  const { from, to } = parseDateRange(req.query, 30);
  const { agencyId } = req.query;

  const filter = { status: { $in: ["Completed", "NoShow"] } };
  if (from) filter.serviceDate = { ...filter.serviceDate, $gte: from };
  if (to) filter.serviceDate = { ...filter.serviceDate, $lte: to };
  if (agencyId) filter.agencyId = agencyId;

  const [trips, batches] = await Promise.all([
    NemtTripModel.find(filter)
      .select("agencyId status agencyFare billingStatus billedAt")
      .lean(),
    NemtPaymentBatchModel.find({ batchType: "agency_billing" })
      .select("agencyId totalAmount tripCount status paidAt createdAt")
      .lean(),
  ]);

  const agencyMap = new Map();
  for (const t of trips) {
    if (!t.agencyId) continue;
    if (!agencyMap.has(t.agencyId)) {
      agencyMap.set(t.agencyId, {
        agencyId: t.agencyId,
        totalTrips: 0,
        completedTrips: 0,
        noShowTrips: 0,
        totalFare: 0,
        billedFare: 0,
        unbilledFare: 0,
        paidFare: 0,
      });
    }
    const a = agencyMap.get(t.agencyId);
    a.totalTrips += 1;
    if (t.status === "Completed") a.completedTrips += 1;
    else a.noShowTrips += 1;
    const fare = t.agencyFare || 0;
    a.totalFare += fare;
    if (["billed", "paid"].includes(t.billingStatus)) a.billedFare += fare;
    else a.unbilledFare += fare;
    if (t.billingStatus === "paid") a.paidFare += fare;
  }

  // Attach batch totals
  for (const b of batches) {
    if (!agencyMap.has(b.agencyId)) continue;
    // Batches already counted in trip billingStatus; just count number of batches
    const a = agencyMap.get(b.agencyId);
    if (!a.batchCount) a.batchCount = 0;
    a.batchCount += 1;
  }

  const rows = [...agencyMap.values()].sort((a, b) => b.totalFare - a.totalFare);

  return res.status(200).json({
    from: from?.toISOString(),
    to: to?.toISOString(),
    agencyCount: rows.length,
    agencies: rows,
  });
}

// GET /nemt/reports/live-runs  — lightweight active-run snapshot for admin dashboard
export async function liveRunsSnapshot(req, res) {
  const runs = await NemtRunModel.find({
    status: { $in: ["Dispatched", "Acknowledged", "Active"] },
  })
    .sort({ serviceDate: 1 })
    .lean();

  return res.status(200).json({ runs });
}

// GET /nemt/reports/runs — run-level performance summary
export async function runsReport(req, res) {
  const { from, to } = parseDateRange(req.query, 30);
  const { driverId } = req.query;

  const filter = {};
  if (from) filter.serviceDate = { ...filter.serviceDate, $gte: from };
  if (to) filter.serviceDate = { ...filter.serviceDate, $lte: to };
  if (driverId) filter.driverId = driverId;

  const runs = await NemtRunModel.find(filter)
    .select("runId serviceDate driverId cabNumber status tripCount completedCount noShowCount cancelledCount acknowledgedAt startedAt completedAt")
    .sort({ serviceDate: -1 })
    .lean();

  const totals = { total: 0, completed: 0, active: 0, cancelled: 0, dispatched: 0, acknowledged: 0 };
  for (const r of runs) {
    totals.total += 1;
    if (r.status === "Completed") totals.completed += 1;
    else if (r.status === "Cancelled") totals.cancelled += 1;
    else if (r.status === "Active") totals.active += 1;
    else if (r.status === "Dispatched") totals.dispatched += 1;
    else if (r.status === "Acknowledged") totals.acknowledged += 1;
  }

  const rows = runs.map((r) => {
    const tripsDone = (r.completedCount || 0) + (r.noShowCount || 0) + (r.cancelledCount || 0);
    const durationMs = r.startedAt && r.completedAt
      ? new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()
      : null;
    return {
      runId: r.runId,
      serviceDate: r.serviceDate ? new Date(r.serviceDate).toISOString().substring(0, 10) : null,
      driverId: r.driverId || null,
      cabNumber: r.cabNumber || null,
      status: r.status,
      tripCount: r.tripCount || 0,
      completedCount: r.completedCount || 0,
      noShowCount: r.noShowCount || 0,
      cancelledCount: r.cancelledCount || 0,
      completionPct: r.tripCount > 0 ? Math.round((tripsDone / r.tripCount) * 100) : null,
      acknowledgedAt: r.acknowledgedAt || null,
      startedAt: r.startedAt || null,
      completedAt: r.completedAt || null,
      durationMinutes: durationMs != null ? Math.round(durationMs / 60_000) : null,
    };
  });

  return res.status(200).json({
    from: from?.toISOString(),
    to: to?.toISOString(),
    ...totals,
    runs: rows,
  });
}

// GET /nemt/reports/import-quality — import batch quality summary
export async function importQualityReport(req, res) {
  const { from, to } = parseDateRange(req.query, 30);
  const { agencyId } = req.query;

  const filter = {};
  if (agencyId) filter.agencyId = agencyId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  const batches = await NemtImportBatchModel.find(filter)
    .select("batchId agencyId serviceDate status sourceFileName totalRows validRows warningRows errorRows importedRows skippedRows createdAt committedAt cancelledAt rolledBackAt")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  const totals = {
    totalBatches: batches.length,
    committed: 0,
    partiallyCommitted: 0,
    cancelled: 0,
    staged: 0,
    totalRows: 0,
    validRows: 0,
    warningRows: 0,
    errorRows: 0,
    importedRows: 0,
    skippedRows: 0,
    duplicateRows: 0,
  };

  const rows = batches.map((b) => {
    totals.totalRows += b.totalRows || 0;
    totals.validRows += b.validRows || 0;
    totals.warningRows += b.warningRows || 0;
    totals.errorRows += b.errorRows || 0;
    totals.importedRows += b.importedRows || 0;
    totals.skippedRows += b.skippedRows || 0;
    if (b.status === "committed") totals.committed += 1;
    else if (b.status === "partially_committed") totals.partiallyCommitted += 1;
    else if (b.status === "cancelled") totals.cancelled += 1;
    else totals.staged += 1;
    const qualityPct = b.totalRows > 0
      ? (((b.validRows || 0) / b.totalRows) * 100).toFixed(1)
      : null;
    return {
      id: b._id.toString(),
      batchId: b.batchId,
      agencyId: b.agencyId,
      serviceDate: b.serviceDate ? new Date(b.serviceDate).toISOString().substring(0, 10) : null,
      status: b.status,
      sourceFileName: b.sourceFileName,
      totalRows: b.totalRows,
      validRows: b.validRows,
      warningRows: b.warningRows,
      errorRows: b.errorRows,
      importedRows: b.importedRows,
      skippedRows: b.skippedRows,
      qualityPct,
      createdAt: b.createdAt,
      committedAt: b.committedAt || null,
      cancelledAt: b.cancelledAt || null,
      rolledBackAt: b.rolledBackAt || null,
    };
  });

  return res.status(200).json({
    from: from?.toISOString(),
    to: to?.toISOString(),
    totals,
    batches: rows,
  });
}

// GET /nemt/reports/proof-of-service — proof-of-service capture completeness
export async function proofOfServiceReport(req, res) {
  const { from, to } = parseDateRange(req.query, 30);
  const { agencyId, driverId } = req.query;

  const filter = { status: { $in: ["Completed", "NoShow"] } };
  if (from) filter.serviceDate = { ...filter.serviceDate, $gte: from };
  if (to) filter.serviceDate = { ...filter.serviceDate, $lte: to };
  if (agencyId) filter.agencyId = agencyId;
  if (driverId) filter.driverId = driverId;

  const trips = await NemtTripModel.find(filter)
    .select("tripId agencyId serviceDate passengerName status driverId mobilityType proofOfService scheduledPickupTime")
    .sort({ serviceDate: -1 })
    .lean();

  const totals = {
    total: 0,
    hasPickupGps: 0,
    hasDropoffGps: 0,
    hasNoShowGps: 0,
    hasDriverNote: 0,
    hasFlaggedIssue: 0,
    missingPickupGps: 0,
    missingDropoffGps: 0,
  };

  const rows = trips.map((t) => {
    const pos = t.proofOfService || {};
    const hasPickup = !!(pos.pickupGps?.lon && pos.pickupGps?.lat);
    const hasDropoff = !!(pos.dropoffGps?.lon && pos.dropoffGps?.lat);
    const hasNoShow = !!(pos.noShowGps?.lon && pos.noShowGps?.lat);
    const hasNote = !!(pos.driverNote?.trim());
    const hasFlag = pos.issueFlag === true;

    totals.total += 1;
    if (hasPickup) totals.hasPickupGps += 1;
    if (hasDropoff) totals.hasDropoffGps += 1;
    if (hasNoShow) totals.hasNoShowGps += 1;
    if (hasNote) totals.hasDriverNote += 1;
    if (hasFlag) totals.hasFlaggedIssue += 1;
    if (t.status === "Completed" && !hasPickup) totals.missingPickupGps += 1;
    if (t.status === "Completed" && !hasDropoff) totals.missingDropoffGps += 1;

    return {
      tripId: t.tripId,
      agencyId: t.agencyId,
      serviceDate: t.serviceDate ? new Date(t.serviceDate).toISOString().substring(0, 10) : null,
      passengerName: t.passengerName,
      status: t.status,
      driverId: t.driverId || null,
      mobilityType: t.mobilityType,
      hasPickupGps: hasPickup,
      hasDropoffGps: hasDropoff,
      hasNoShowGps: hasNoShow,
      hasDriverNote: hasNote,
      hasFlaggedIssue: hasFlag,
      pickupGpsCapturedAt: pos.pickupGps?.capturedAt || null,
      dropoffGpsCapturedAt: pos.dropoffGps?.capturedAt || null,
      driverNote: hasNote ? pos.driverNote : null,
    };
  });

  return res.status(200).json({
    from: from?.toISOString(),
    to: to?.toISOString(),
    totals,
    trips: rows,
  });
}

// GET /nemt/reports/cancellations — no-show and cancellation breakdown
export async function cancellationsReport(req, res) {
  const { from, to } = parseDateRange(req.query, 30);
  const { agencyId, driverId } = req.query;

  const filter = { status: { $in: ["Cancelled", "NoShow", "PassengerCancelled"] } };
  if (from) filter.serviceDate = { ...filter.serviceDate, $gte: from };
  if (to) filter.serviceDate = { ...filter.serviceDate, $lte: to };
  if (agencyId) filter.agencyId = agencyId;
  if (driverId) filter.driverId = driverId;

  const trips = await NemtTripModel.find(filter)
    .select("tripId agencyId serviceDate passengerName status driverId cancelReason noShowReason cancelledBy createdAt cancelledAt noShowAt")
    .sort({ serviceDate: -1 })
    .lean();

  const byStatus = { Cancelled: 0, NoShow: 0, PassengerCancelled: 0 };
  const byDriver = new Map();
  const byAgency = new Map();

  for (const t of trips) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;

    if (t.driverId) {
      const d = byDriver.get(t.driverId) || { driverId: t.driverId, cancelled: 0, noShow: 0, passengerCancelled: 0 };
      if (t.status === "Cancelled") d.cancelled += 1;
      else if (t.status === "NoShow") d.noShow += 1;
      else d.passengerCancelled += 1;
      byDriver.set(t.driverId, d);
    }

    if (t.agencyId) {
      const a = byAgency.get(t.agencyId) || { agencyId: t.agencyId, cancelled: 0, noShow: 0, passengerCancelled: 0 };
      if (t.status === "Cancelled") a.cancelled += 1;
      else if (t.status === "NoShow") a.noShow += 1;
      else a.passengerCancelled += 1;
      byAgency.set(t.agencyId, a);
    }
  }

  return res.status(200).json({
    from: from?.toISOString(),
    to: to?.toISOString(),
    total: trips.length,
    byStatus,
    byDriver: [...byDriver.values()].sort((a, b) => (b.cancelled + b.noShow + b.passengerCancelled) - (a.cancelled + a.noShow + a.passengerCancelled)),
    byAgency: [...byAgency.values()].sort((a, b) => (b.cancelled + b.noShow + b.passengerCancelled) - (a.cancelled + a.noShow + a.passengerCancelled)),
    trips: trips.map((t) => ({
      tripId: t.tripId,
      agencyId: t.agencyId,
      serviceDate: t.serviceDate ? new Date(t.serviceDate).toISOString().substring(0, 10) : null,
      passengerName: t.passengerName,
      status: t.status,
      driverId: t.driverId || null,
      cancelledBy: t.cancelledBy || null,
      reason: t.status === "NoShow" ? (t.noShowReason || null) : (t.cancelReason || null),
      occurredAt: t.cancelledAt || t.noShowAt || null,
    })),
  });
}
