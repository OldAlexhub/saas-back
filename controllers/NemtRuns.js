import NemtRunModel from "../models/NemtRunSchema.js";
import NemtTripModel from "../models/NemtTripSchema.js";
import { NEMT_SETTINGS_ID, NemtSettingsModel } from "../models/NemtSettingsSchema.js";
import { toAdminNemtRunPayload, toDriverNemtRunPayload } from "../realtime/nemtPayloads.js";
import { emitToAdmins, emitToDriver } from "../realtime/index.js";
import { optimizeRun } from "../services/nemtOptimizer.js";
import { saveWithIdRetry } from "../utils/saveWithRetry.js";

const ACTIVE_TRIP_STATUSES = new Set(["EnRoute", "ArrivedPickup", "PickedUp", "ArrivedDrop"]);

// Recalculate runSequence for all trips in a run after any reorder/add/remove.
async function resequenceRunTrips(runId, orderedTripIds) {
  const ops = orderedTripIds.map((tripId, idx) =>
    NemtTripModel.updateOne({ _id: tripId }, { $set: { runSequence: idx } })
  );
  await Promise.all(ops);
}

export async function listRuns(req, res) {
  const { serviceDate, status, driverId, page = "1", limit = "50" } = req.query;
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
  if (trip.runId && trip.runId.toString() !== run._id.toString()) {
    return res.status(409).json({ message: "Trip is already assigned to a different run." });
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

  emitToAdmins("nemt:run-updated", toAdminNemtRunPayload(run));
  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:manifest-updated", {
      runId: run.runId,
      id: run._id.toString(),
      reason: "trip_added",
      message: "A new stop has been added to your manifest.",
    });
  }
  return res.status(200).json({ run: toAdminNemtRunPayload(run) });
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

  emitToAdmins("nemt:run-updated", toAdminNemtRunPayload(run));
  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:manifest-updated", {
      runId: run.runId,
      id: run._id.toString(),
      reason: "trip_removed",
      message: "A stop has been removed from your manifest.",
    });
  }
  return res.status(200).json({ run: toAdminNemtRunPayload(run) });
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

  emitToAdmins("nemt:run-updated", toAdminNemtRunPayload(run));
  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:manifest-updated", {
      runId: run.runId,
      id: run._id.toString(),
      reason: "reordered",
      message: "Your manifest has been re-sequenced by dispatch.",
    });
  }
  return res.status(200).json({ run: toAdminNemtRunPayload(run) });
}

export async function optimizeRunController(req, res) {
  const run = await NemtRunModel.findById(req.params.id);
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (run.status === "Cancelled") return res.status(409).json({ message: "Cannot optimize a cancelled run." });
  if (run.status === "Completed") return res.status(409).json({ message: "Cannot optimize a completed run." });

  const trips = await NemtTripModel.find({ _id: { $in: run.trips } }).lean();
  // Preserve current run order before passing to optimizer
  const ordered = run.trips
    .map((id) => trips.find((t) => t._id.toString() === id.toString()))
    .filter(Boolean);

  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  const optimizedIds = optimizeRun(ordered, settings);

  run.trips = optimizedIds;
  run.optimizationVersion += 1;
  run.optimizedAt = new Date();
  await run.save();
  await resequenceRunTrips(run._id, run.trips);

  emitToAdmins("nemt:run-optimized", toAdminNemtRunPayload(run));
  if (run.driverId) {
    emitToDriver(run.driverId, "nemt:manifest-updated", {
      runId: run.runId,
      id: run._id.toString(),
      reason: "optimized",
      message: "Your manifest has been re-optimized by dispatch.",
    });
  }
  return res.status(200).json({ run: toAdminNemtRunPayload(run) });
}

export async function dispatchRun(req, res) {
  const run = await NemtRunModel.findById(req.params.id).populate("trips");
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (!run.driverId) {
    return res.status(400).json({ message: "Run must have an assigned driver before dispatching." });
  }
  if (run.status === "Cancelled") return res.status(409).json({ message: "Cannot dispatch a cancelled run." });
  if (run.status === "Completed") return res.status(409).json({ message: "Run is already completed." });

  run.status = "Dispatched";
  run.dispatchedAt = new Date();
  await run.save();

  // Mark all unstarted trips as Dispatched
  await NemtTripModel.updateMany(
    { runId: run._id, status: { $in: ["Scheduled", "Assigned"] } },
    { $set: { status: "Dispatched", dispatchedAt: run.dispatchedAt } }
  );

  const driverPayload = toDriverNemtRunPayload(run, { populatedTrips: true });
  emitToDriver(run.driverId, "nemt:run-dispatched", driverPayload);
  emitToAdmins("nemt:run-dispatched", toAdminNemtRunPayload(run));

  return res.status(200).json({ run: toAdminNemtRunPayload(run) });
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
