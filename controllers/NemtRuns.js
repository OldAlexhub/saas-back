import NemtRunModel from "../models/NemtRunSchema.js";
import NemtTripModel from "../models/NemtTripSchema.js";
import { NEMT_SETTINGS_ID, NemtSettingsModel } from "../models/NemtSettingsSchema.js";
import { toAdminNemtRunPayload, toDriverNemtRunPayload } from "../realtime/nemtPayloads.js";
import { emitToAdmins, emitToDriver } from "../realtime/index.js";
import { optimizeRunDetailed } from "../services/nemtOptimizer.js";
import { autoAssignTripsToRuns } from "../services/nemtScheduler.js";
import ActiveModel from "../models/ActiveSchema.js";
import { getCapacityIssues } from "../services/nemtCapacity.js";
import { saveWithIdRetry } from "../utils/saveWithRetry.js";

const ACTIVE_TRIP_STATUSES = new Set(["EnRoute", "ArrivedPickup", "PickedUp", "ArrivedDrop"]);

function startOfUtcDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfUtcDay(value) {
  const date = startOfUtcDay(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function buildServiceDateFilter(query = {}) {
  if (query.serviceDate) {
    const from = startOfUtcDay(query.serviceDate);
    const to = endOfUtcDay(query.serviceDate);
    if (from && to) return { $gte: from, $lt: to };
  }

  const range = {};
  if (query.serviceDate_gte || query.from) {
    const from = startOfUtcDay(query.serviceDate_gte || query.from);
    if (from) range.$gte = from;
  }
  if (query.serviceDate_lte || query.to) {
    const to = endOfUtcDay(query.serviceDate_lte || query.to);
    if (to) range.$lt = to;
  }
  return Object.keys(range).length ? range : null;
}

function sameServiceDay(a, b) {
  const da = startOfUtcDay(a);
  const db = startOfUtcDay(b);
  return da && db && da.getTime() === db.getTime();
}

async function populatedRunPayload(runId) {
  const run = await NemtRunModel.findById(runId).populate("trips").lean();
  return toAdminNemtRunPayload(run, { populatedTrips: true });
}

async function buildOptimizationProposal(run, settings) {
  const trips = await NemtTripModel.find({ _id: { $in: run.trips } }).lean();
  const ordered = run.trips
    .map((id) => trips.find((t) => t._id.toString() === id.toString()))
    .filter(Boolean);
  const optimized = optimizeRunDetailed(ordered, settings);
  const byId = new Map(trips.map((trip) => [trip._id.toString(), trip]));
  return {
    ...optimized,
    proposedTrips: optimized.orderedIds
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((trip) => ({
        id: trip._id.toString(),
        tripId: trip.tripId,
        passengerName: trip.passengerName,
        pickupAddress: trip.pickupAddress,
        dropoffAddress: trip.dropoffAddress,
        scheduledPickupTime: trip.scheduledPickupTime,
        appointmentTime: trip.appointmentTime,
        status: trip.status,
      })),
  };
}

// Recalculate runSequence for all trips in a run after any reorder/add/remove.
async function resequenceRunTrips(runId, orderedTripIds) {
  const ops = orderedTripIds.map((tripId, idx) =>
    NemtTripModel.updateOne({ _id: tripId }, { $set: { runSequence: idx } })
  );
  await Promise.all(ops);
}

export async function listRuns(req, res) {
  const { status, driverId, page = "1", limit = "50" } = req.query;
  const filter = {};

  const serviceDateFilter = buildServiceDateFilter(req.query);
  if (serviceDateFilter) filter.serviceDate = serviceDateFilter;
  if (status) {
    filter.status = { $in: Array.isArray(status) ? status : status.split(",") };
  }
  if (driverId) filter.driverId = driverId;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [runs, total] = await Promise.all([
    NemtRunModel.find(filter)
      .sort({ serviceDate: 1, createdAt: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    NemtRunModel.countDocuments(filter),
  ]);

  return res.status(200).json({ runs: runs.map(toAdminNemtRunPayload), total, page: pageNum, limit: limitNum });
}

export async function createRun(req, res) {
  const run = new NemtRunModel(req.body);
  if ((run.driverId || run.cabNumber) && run.status === "Unassigned") {
    run.status = "Assigned";
  }
  await saveWithIdRetry(() => run.save(), ["runId"]);
  emitToAdmins("nemt:run-created", toAdminNemtRunPayload(run));
  return res.status(201).json({ run: toAdminNemtRunPayload(run) });
}

export async function autoAssignRuns(req, res) {
  try {
    const result = await autoAssignTripsToRuns(req.body || {});
    const payload = {
      ...result,
      runs: result.committed
        ? result.runs.map((run) => toAdminNemtRunPayload(run, { populatedTrips: true }))
        : result.runs,
    };
    if (result.committed) {
      emitToAdmins("nemt:runs-auto-assigned", {
        serviceDate: result.serviceDate,
        tripCount: result.tripCount,
        runCount: result.runCount,
        warnings: result.warnings,
      });
    }
    return res.status(result.committed ? 201 : 200).json(payload);
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      message: err.message || "Automatic NEMT assignment failed.",
    });
  }
}

export async function getRunById(req, res) {
  const run = await NemtRunModel.findById(req.params.id).populate("trips").lean();
  if (!run) return res.status(404).json({ message: "Run not found." });
  return res.status(200).json({ run: toAdminNemtRunPayload(run, { populatedTrips: true }) });
}

export async function updateRun(req, res) {
  const { label, driverId, cabNumber, notes } = req.body;
  const run = await NemtRunModel.findById(req.params.id);
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (run.status === "Cancelled") {
    return res.status(409).json({ message: "Cannot edit a cancelled run." });
  }

  if (label !== undefined) run.label = label;
  if (driverId !== undefined) run.driverId = driverId;
  if (cabNumber !== undefined) run.cabNumber = cabNumber;
  if (notes !== undefined) run.notes = notes;
  if ((run.driverId || run.cabNumber) && run.status === "Unassigned") {
    run.status = "Assigned";
  }

  await run.save();

  // Sync driverId/cabNumber to assigned trips so driver queries stay accurate
  if (driverId !== undefined || cabNumber !== undefined) {
    await NemtTripModel.updateMany(
      { runId: run._id, status: { $in: ["Scheduled", "Assigned", "Dispatched"] } },
      { $set: { driverId: run.driverId, cabNumber: run.cabNumber } }
    );
  }

  emitToAdmins("nemt:run-updated", toAdminNemtRunPayload(run));
  return res.status(200).json({ run: toAdminNemtRunPayload(run) });
}

export async function addTripToRun(req, res) {
  const { tripId, position } = req.body;
  const [run, trip] = await Promise.all([
    NemtRunModel.findById(req.params.id),
    NemtTripModel.findById(tripId),
  ]);
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (!trip) return res.status(404).json({ message: "Trip not found." });
  if (run.status === "Cancelled") return res.status(409).json({ message: "Cannot add a trip to a cancelled run." });
  if (run.status === "Completed") return res.status(409).json({ message: "Cannot add a trip to a completed run." });
  if (!sameServiceDay(run.serviceDate, trip.serviceDate)) {
    return res.status(409).json({ message: "Trip service date must match the run service date." });
  }
  if (run.trips.some((t) => t.toString() === trip._id.toString())) {
    return res.status(409).json({ message: "Trip is already assigned to this run." });
  }
  if (trip.runId && trip.runId.toString() !== run._id.toString()) {
    return res.status(409).json({ message: "Trip is already assigned to a different run." });
  }
  if (["Dispatched", "Acknowledged", "Active"].includes(run.status)) {
    const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
    if (settings && settings.allowReoptimizeAfterDispatch === false) {
      return res.status(409).json({ message: "This run cannot be changed after dispatch." });
    }
  }
  if (run.driverId) {
    const active = await ActiveModel.findOne({ driverId: run.driverId }).lean();
    const capacityIssues = active ? getCapacityIssues(active, trip) : [];
    if (capacityIssues.length) {
      return res.status(409).json({ message: capacityIssues.join(" ") });
    }
  }

  const idx = typeof position === "number" ? Math.min(position, run.trips.length) : run.trips.length;
  run.trips.splice(idx, 0, trip._id);
  run.tripCount = run.trips.length;
  await run.save();

  trip.runId = run._id;
  trip.status = "Assigned";
  trip.driverId = run.driverId || trip.driverId;
  trip.cabNumber = run.cabNumber || trip.cabNumber;
  trip.assignedAt = trip.assignedAt || new Date();
  await trip.save();

  await resequenceRunTrips(run._id, run.trips);

  const payload = await populatedRunPayload(run._id);
  emitToAdmins("nemt:run-updated", payload);
  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:manifest-updated", {
      runId: run.runId,
      id: run._id.toString(),
      reason: "trip_added",
      message: "A new stop has been added to your manifest.",
    });
  }
  return res.status(200).json({ run: payload });
}

export async function removeTripFromRun(req, res) {
  const run = await NemtRunModel.findById(req.params.runId);
  if (!run) return res.status(404).json({ message: "Run not found." });

  if (run.status === "Active") {
    const trip = await NemtTripModel.findById(req.params.tripId).lean();
    if (trip && ACTIVE_TRIP_STATUSES.has(trip.status)) {
      return res.status(409).json({ message: "Cannot remove a trip that is currently in progress." });
    }
  }

  run.trips = run.trips.filter((t) => t.toString() !== req.params.tripId);
  run.tripCount = run.trips.length;
  await run.save();

  await NemtTripModel.updateOne(
    { _id: req.params.tripId },
    { $set: { runId: null, runSequence: null, status: "Scheduled", driverId: null, cabNumber: null } }
  );

  await resequenceRunTrips(run._id, run.trips);

  const payload = await populatedRunPayload(run._id);
  emitToAdmins("nemt:run-updated", payload);
  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:manifest-updated", {
      runId: run.runId,
      id: run._id.toString(),
      reason: "trip_removed",
      message: "A stop has been removed from your manifest.",
    });
  }
  return res.status(200).json({ run: payload });
}

export async function reorderRun(req, res) {
  const { tripIds } = req.body;
  const run = await NemtRunModel.findById(req.params.id);
  if (!run) return res.status(404).json({ message: "Run not found." });

  const existing = new Set(run.trips.map((t) => t.toString()));
  const incoming = new Set(tripIds);
  if (
    tripIds.length !== run.trips.length ||
    !tripIds.every((id) => existing.has(id)) ||
    !run.trips.every((t) => incoming.has(t.toString()))
  ) {
    return res.status(400).json({ message: "tripIds must contain exactly the same trips currently in the run." });
  }

  run.trips = tripIds;
  await run.save();
  await resequenceRunTrips(run._id, run.trips);

  const payload = await populatedRunPayload(run._id);
  emitToAdmins("nemt:run-updated", payload);
  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:manifest-updated", {
      runId: run.runId,
      id: run._id.toString(),
      reason: "reordered",
      message: "Your manifest has been re-sequenced by dispatch.",
    });
  }
  return res.status(200).json({ run: payload });
}

export async function optimizeRunController(req, res) {
  const run = await NemtRunModel.findById(req.params.id);
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (run.status === "Cancelled") return res.status(409).json({ message: "Cannot optimize a cancelled run." });
  if (run.status === "Completed") return res.status(409).json({ message: "Cannot optimize a completed run." });

  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  if (["Dispatched", "Acknowledged", "Active"].includes(run.status) && settings?.allowReoptimizeAfterDispatch === false) {
    return res.status(409).json({ message: "This run cannot be re-optimized after dispatch." });
  }

  const trips = await NemtTripModel.find({ _id: { $in: run.trips } }).lean();
  // Preserve current run order before passing to optimizer
  const ordered = run.trips
    .map((id) => trips.find((t) => t._id.toString() === id.toString()))
    .filter(Boolean);

  const optimized = optimizeRunDetailed(ordered, settings);

  run.trips = optimized.orderedIds;
  run.optimizationVersion += 1;
  run.optimizedAt = new Date();
  if (!Array.isArray(run.history)) run.history = [];
  run.history.push({
    action: "optimize",
    after: {
      changedCount: optimized.changedCount,
      warningCount: optimized.warnings.length,
      optimizationVersion: run.optimizationVersion,
    },
    note: "Run optimized by dispatch",
  });
  await run.save();
  await resequenceRunTrips(run._id, run.trips);

  const payload = await populatedRunPayload(run._id);
  emitToAdmins("nemt:run-optimized", payload);
  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:manifest-updated", {
      runId: run.runId,
      id: run._id.toString(),
      reason: "optimized",
      message: "Your manifest has been re-optimized by dispatch.",
    });
  }
  return res.status(200).json({
    run: payload,
    optimizedCount: optimized.changedCount,
    warnings: optimized.warnings,
  });
}

export async function previewRunOptimization(req, res) {
  const run = await NemtRunModel.findById(req.params.id);
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (run.status === "Cancelled") return res.status(409).json({ message: "Cannot optimize a cancelled run." });
  if (run.status === "Completed") return res.status(409).json({ message: "Cannot optimize a completed run." });

  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  if (["Dispatched", "Acknowledged", "Active"].includes(run.status) && settings?.allowReoptimizeAfterDispatch === false) {
    return res.status(409).json({ message: "This run cannot be re-optimized after dispatch." });
  }

  const proposal = await buildOptimizationProposal(run, settings);
  return res.status(200).json({
    run: await populatedRunPayload(run._id),
    proposal: {
      orderedIds: proposal.orderedIds,
      proposedTrips: proposal.proposedTrips,
      changedCount: proposal.changedCount,
      warnings: proposal.warnings,
      requiresApproval: ["Dispatched", "Acknowledged", "Active"].includes(run.status),
    },
  });
}

export async function applyRunOptimization(req, res) {
  const { orderedIds } = req.body || {};
  const run = await NemtRunModel.findById(req.params.id);
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (run.status === "Cancelled") return res.status(409).json({ message: "Cannot optimize a cancelled run." });
  if (run.status === "Completed") return res.status(409).json({ message: "Cannot optimize a completed run." });

  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  if (["Dispatched", "Acknowledged", "Active"].includes(run.status) && settings?.allowReoptimizeAfterDispatch === false) {
    return res.status(409).json({ message: "This run cannot be re-optimized after dispatch." });
  }

  const currentOrder = run.trips.map((t) => t.toString());
  const proposal = Array.isArray(orderedIds) && orderedIds.length
    ? {
        orderedIds,
        changedCount: orderedIds.filter((id, idx) => String(id) !== currentOrder[idx]).length,
        warnings: [],
      }
    : await buildOptimizationProposal(run, settings);

  const existing = new Set(currentOrder);
  if (
    proposal.orderedIds.length !== run.trips.length ||
    !proposal.orderedIds.every((id) => existing.has(String(id)))
  ) {
    return res.status(400).json({ message: "Proposed order must contain exactly the same trips currently in the run." });
  }

  run.trips = proposal.orderedIds;
  run.optimizationVersion += 1;
  run.optimizedAt = new Date();
  if (!Array.isArray(run.history)) run.history = [];
  run.history.push({
    action: "reoptimize_apply",
    after: {
      changedCount: proposal.changedCount,
      warningCount: proposal.warnings.length,
      optimizationVersion: run.optimizationVersion,
    },
    note: ["Dispatched", "Acknowledged", "Active"].includes(run.status)
      ? "Dispatched run reoptimization approved by dispatch"
      : "Run optimization applied",
  });
  await run.save();
  await resequenceRunTrips(run._id, run.trips);

  const payload = await populatedRunPayload(run._id);
  emitToAdmins("nemt:run-optimized", payload);
  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:manifest-updated", {
      runId: run.runId,
      id: run._id.toString(),
      reason: "reoptimized",
      message: "Your manifest has been re-optimized by dispatch.",
    });
  }

  return res.status(200).json({
    run: payload,
    optimizedCount: proposal.changedCount,
    warnings: proposal.warnings,
  });
}

export async function dispatchRun(req, res) {
  const run = await NemtRunModel.findById(req.params.id).populate("trips");
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (!run.driverId) {
    return res.status(400).json({ message: "Run must have an assigned driver before dispatching." });
  }
  if (run.status === "Cancelled") return res.status(409).json({ message: "Cannot dispatch a cancelled run." });
  if (run.status === "Completed") return res.status(409).json({ message: "Run is already completed." });
  if (!Array.isArray(run.trips) || run.trips.length === 0) {
    return res.status(400).json({ message: "Run must have at least one trip before dispatching." });
  }

  run.status = "Dispatched";
  run.dispatchedAt = new Date();
  if (!Array.isArray(run.history)) run.history = [];
  run.history.push({
    action: "dispatch",
    after: { status: "Dispatched", dispatchedAt: run.dispatchedAt },
    note: "Run dispatched to driver",
  });
  await run.save();

  // Mark all unstarted trips as Dispatched
  await NemtTripModel.updateMany(
    { runId: run._id, status: { $in: ["Scheduled", "Assigned"] } },
    { $set: { status: "Dispatched", dispatchedAt: run.dispatchedAt } }
  );

  const refreshed = await NemtRunModel.findById(run._id).populate("trips").lean();
  const driverPayload = toDriverNemtRunPayload(refreshed, { populatedTrips: true });
  emitToDriver(run.driverId, "nemt:run-dispatched", driverPayload);
  const adminPayload = toAdminNemtRunPayload(refreshed, { populatedTrips: true });
  emitToAdmins("nemt:run-dispatched", adminPayload);

  return res.status(200).json({ run: adminPayload });
}

export async function cancelRun(req, res) {
  const { cancelReason } = req.body;
  const run = await NemtRunModel.findById(req.params.id);
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (run.status === "Cancelled") return res.status(409).json({ message: "Run is already cancelled." });
  if (run.status === "Completed") return res.status(409).json({ message: "Cannot cancel a completed run." });

  run.status = "Cancelled";
  run.cancelReason = cancelReason;
  run.cancelledAt = new Date();
  await run.save();

  await NemtTripModel.updateMany(
    { runId: run._id, status: { $in: ["Scheduled", "Assigned", "Dispatched", "EnRoute"] } },
    {
      $set: {
        status: "Cancelled",
        cancelledBy: "dispatch",
        cancelReason: cancelReason || "Run cancelled by dispatch.",
        cancelledAt: run.cancelledAt,
      },
    }
  );

  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:run-cancelled", {
      runId: run.runId,
      id: run._id.toString(),
      message: "Your manifest has been cancelled by dispatch.",
    });
  }
  emitToAdmins("nemt:run-cancelled", toAdminNemtRunPayload(run));

  return res.status(200).json({ run: toAdminNemtRunPayload(run) });
}
