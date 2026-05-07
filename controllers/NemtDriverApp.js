import NemtRunModel from "../models/NemtRunSchema.js";
import NemtTripModel, { NEMT_DRIVER_TRIP_SELECT } from "../models/NemtTripSchema.js";
import { NEMT_SETTINGS_ID, NemtSettingsModel } from "../models/NemtSettingsSchema.js";
import NemtPaymentBatchModel from "../models/NemtPaymentBatchSchema.js";
import NemtTripEventModel from "../models/NemtTripEventSchema.js";
import { toDriverNemtRunPayload, toDriverNemtTripPayload } from "../realtime/nemtPayloads.js";
import { emitToAdmins } from "../realtime/index.js";

// Valid status transitions the driver is allowed to trigger
const DRIVER_STATUS_TRANSITIONS = {
  Dispatched: ["EnRoute"],
  EnRoute: ["ArrivedPickup"],
  ArrivedPickup: ["PickedUp", "NoShow", "PassengerCancelled"],
  PickedUp: ["ArrivedDrop"],
  ArrivedDrop: ["Completed"],
};

const DRIVER_TERMINAL_STATUSES = new Set([
  "Completed",
  "Cancelled",
  "NoShow",
  "PassengerCancelled",
]);

export async function getMyNemtRuns(req, res) {
  const { driverId } = req.driver;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const inSevenDays = new Date(today);
  inSevenDays.setDate(today.getDate() + 7);

  const runs = await NemtRunModel.find({
    driverId,
    serviceDate: { $gte: today, $lt: inSevenDays },
    status: { $in: ["Dispatched", "Acknowledged", "Active", "Completed"] },
  })
    .sort({ serviceDate: 1 })
    .lean();

  return res.status(200).json({ runs: runs.map(toDriverNemtRunPayload) });
}

export async function getNemtRunById(req, res) {
  const { driverId } = req.driver;
  const run = await NemtRunModel.findOne({ _id: req.params.id, driverId }).populate({
    path: "trips",
    select: NEMT_DRIVER_TRIP_SELECT,
  });
  if (!run) return res.status(404).json({ message: "Run not found." });
  return res.status(200).json({ run: toDriverNemtRunPayload(run, { populatedTrips: true }) });
}

export async function acknowledgeNemtRun(req, res) {
  const { driverId } = req.driver;
  const run = await NemtRunModel.findOne({ _id: req.params.id, driverId });
  if (!run) return res.status(404).json({ message: "Run not found." });
  if (!["Dispatched", "Acknowledged"].includes(run.status)) {
    return res.status(409).json({
      message: `Run cannot be acknowledged from status '${run.status}'.`,
    });
  }

  run.status = "Acknowledged";
  run.acknowledgedAt = run.acknowledgedAt || new Date();
  await run.save();

  emitToAdmins("nemt:run-acknowledged", {
    runId: run.runId,
    id: run._id.toString(),
    driverId,
    acknowledgedAt: run.acknowledgedAt,
  });

  return res.status(200).json({ run: toDriverNemtRunPayload(run) });
}

export async function updateNemtTripStatus(req, res) {
  const { driverId } = req.driver;
  const {
    status, actualMiles, noShowReason, passengerCancelReason, eventId, capturedAt,
    gpsLon, gpsLat, driverNote, issueFlag,
  } = req.body;

  if (eventId) {
    const existingEvent = await NemtTripEventModel.findOne({ driverId, eventId }).lean();
    if (existingEvent) {
      const currentTrip = await NemtTripModel.findById(req.params.id).select(NEMT_DRIVER_TRIP_SELECT).lean();
      return res.status(200).json({ trip: toDriverNemtTripPayload(currentTrip), duplicate: true });
    }
  }

  const trip = await NemtTripModel.findById(req.params.id);
  if (!trip) return res.status(404).json({ message: "Trip not found." });
  if (trip.driverId !== driverId) {
    return res.status(403).json({ message: "This trip is not assigned to you." });
  }
  if (DRIVER_TERMINAL_STATUSES.has(trip.status)) {
    return res.status(409).json({ message: `Trip is already in terminal status '${trip.status}'.` });
  }

  const allowed = DRIVER_STATUS_TRANSITIONS[trip.status] || [];
  if (!allowed.includes(status)) {
    return res.status(400).json({
      message: `Cannot transition from '${trip.status}' to '${status}'.`,
    });
  }

  const receivedAt = new Date();
  const eventTime = capturedAt && !Number.isNaN(new Date(capturedAt).getTime())
    ? new Date(capturedAt)
    : receivedAt;
  const prevStatus = trip.status;
  trip.status = status;

  const hasGps = Number.isFinite(gpsLon) && Number.isFinite(gpsLat);

  switch (status) {
    case "EnRoute":
      trip.enRouteAt = eventTime;
      break;
    case "ArrivedPickup":
      trip.arrivedPickupAt = eventTime;
      if (hasGps) {
        trip.proofOfService = {
          ...(trip.proofOfService || {}),
          pickupGps: { lon: gpsLon, lat: gpsLat, capturedAt: eventTime },
        };
      }
      break;
    case "PickedUp":
      trip.pickedUpAt = eventTime;
      break;
    case "ArrivedDrop":
      trip.arrivedDropAt = eventTime;
      break;
    case "Completed": {
      trip.completedAt = eventTime;
      if (actualMiles != null) trip.actualMiles = actualMiles;
      if (hasGps) {
        trip.proofOfService = {
          ...(trip.proofOfService || {}),
          dropoffGps: { lon: gpsLon, lat: gpsLat, capturedAt: eventTime },
        };
      }
      if (driverNote) {
        trip.proofOfService = { ...(trip.proofOfService || {}), driverNote };
      }
      if (issueFlag != null) {
        trip.proofOfService = { ...(trip.proofOfService || {}), issueFlag: Boolean(issueFlag) };
      }

      // OTP calculation
      if (trip.scheduledPickupTime && trip.pickedUpAt) {
        const diffMin =
          (trip.pickedUpAt.getTime() - new Date(trip.scheduledPickupTime).getTime()) / 60_000;
        trip.scheduledVsActualMinutes = Math.round(diffMin);
        const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
        const onTimeMax = settings?.otpOnTimeMaxMinutes ?? 15;
        const lateMax = settings?.otpLateMaxMinutes ?? 30;
        if (diffMin < 0) trip.otpStatus = "early";
        else if (diffMin <= onTimeMax) trip.otpStatus = "on_time";
        else if (diffMin <= lateMax) trip.otpStatus = "late";
        else trip.otpStatus = "very_late";

        // Per-mile pay: only calculate if driverPay not already set and miles were reported
        if (trip.driverPay == null && actualMiles > 0) {
          const perMile = settings?.defaultPayRatePerMile ?? 0;
          if (settings?.defaultPayBasis === "per_mile" && perMile > 0) {
            trip.driverPay = parseFloat((actualMiles * perMile).toFixed(2));
          }
        }
      }
      break;
    }
    case "NoShow":
      trip.noShowAt = eventTime;
      if (noShowReason) trip.noShowReason = noShowReason;
      if (hasGps) {
        trip.proofOfService = {
          ...(trip.proofOfService || {}),
          noShowGps: { lon: gpsLon, lat: gpsLat, capturedAt: eventTime },
        };
      }
      if (driverNote) {
        trip.proofOfService = { ...(trip.proofOfService || {}), driverNote };
      }
      if (issueFlag != null) {
        trip.proofOfService = { ...(trip.proofOfService || {}), issueFlag: Boolean(issueFlag) };
      }
      break;
    case "PassengerCancelled":
      trip.cancelledAt = eventTime;
      trip.cancelledBy = "passenger";
      if (passengerCancelReason) trip.cancelReason = passengerCancelReason;
      break;
  }
  trip.markModified("proofOfService");

  await trip.save();
  if (eventId) {
    await NemtTripEventModel.create({
      eventId,
      driverId,
      tripId: trip._id,
      runId: trip.runId,
      type: `status:${status}`,
      capturedAt: eventTime,
      receivedAt,
      payload: { status, actualMiles, noShowReason, passengerCancelReason },
    }).catch((err) => {
      if (err?.code !== 11000) throw err;
    });
  }

  // Promote run to Active when driver begins first trip in the run
  if (status === "EnRoute" && trip.runId) {
    const run = await NemtRunModel.findById(trip.runId);
    if (run && ["Acknowledged", "Dispatched", "Assigned"].includes(run.status)) {
      run.status = "Active";
      run.startedAt = run.startedAt || eventTime;
      await run.save();
      emitToAdmins("nemt:run-started", {
        runId: run.runId,
        id: run._id.toString(),
        driverId,
        startedAt: run.startedAt,
      });
    }
  }

  // Update run counters and auto-complete run when all trips are terminal
  if (["Completed", "NoShow", "PassengerCancelled"].includes(status) && trip.runId) {
    const inc =
      status === "Completed"
        ? { completedCount: 1 }
        : status === "NoShow"
        ? { noShowCount: 1 }
        : { cancelledCount: 1 };
    await NemtRunModel.updateOne({ _id: trip.runId }, { $inc: inc });

    const remainingActive = await NemtTripModel.countDocuments({
      runId: trip.runId,
      status: { $nin: ["Completed", "Cancelled", "NoShow", "PassengerCancelled"] },
    });
    if (remainingActive === 0) {
      const run = await NemtRunModel.findById(trip.runId);
      if (run && run.status === "Active") {
        run.status = "Completed";
        run.completedAt = eventTime;
        await run.save();
        emitToAdmins("nemt:run-completed", {
          runId: run.runId,
          id: run._id.toString(),
          driverId,
          completedAt: run.completedAt,
        });
      }
    }
  }

  emitToAdmins("nemt:trip-status", {
    tripId: trip.tripId,
    id: trip._id.toString(),
    status,
    prevStatus,
    driverId,
  });

  return res.status(200).json({ trip: toDriverNemtTripPayload(trip) });
}

export async function reportNemtTripIssue(req, res) {
  const { driverId } = req.driver;
  const { category, description } = req.body;

  const trip = await NemtTripModel.findById(req.params.id);
  if (!trip) return res.status(404).json({ message: "Trip not found." });
  if (trip.driverId !== driverId) {
    return res.status(403).json({ message: "This trip is not assigned to you." });
  }

  trip.history.push({
    action: "driver_issue_report",
    byUserId: driverId,
    note: `[${category}] ${description}`,
    after: { category, description },
  });
  await trip.save();

  emitToAdmins("nemt:trip-issue-reported", {
    tripId: trip.tripId,
    id: trip._id.toString(),
    driverId,
    category,
    description,
  });

  return res.status(200).json({ ok: true });
}

export async function getMyNemtFinance(req, res) {
  const { driverId } = req.driver;

  const settings = await NemtSettingsModel.findById(NEMT_SETTINGS_ID).lean();
  if (settings && !settings.showDriverFinance) {
    return res.status(403).json({ message: "Finance details are not currently available." });
  }

  const trips = await NemtTripModel.find({
    driverId,
    status: { $in: ["Completed", "NoShow"] },
  })
    .select(
      "tripId serviceDate passengerName status payStatus driverPay paidAt payReference payHoldReason payDisputeReason scheduledPickupTime"
    )
    .sort({ serviceDate: -1 })
    .lean();

  const totals = {
    totalEarned: 0,
    totalPaid: 0,
    totalUnpaid: 0,
    totalHeld: 0,
    totalDisputed: 0,
  };
  for (const t of trips) {
    const pay = t.driverPay || 0;
    totals.totalEarned += pay;
    if (t.payStatus === "paid") totals.totalPaid += pay;
    else if (t.payStatus === "unpaid") totals.totalUnpaid += pay;
    else if (t.payStatus === "held") totals.totalHeld += pay;
    else if (t.payStatus === "disputed") totals.totalDisputed += pay;
  }

  const paymentHistory = await NemtPaymentBatchModel.find({
    driverId,
    batchType: "driver_pay",
    status: "paid",
  })
    .sort({ paidAt: -1 })
    .limit(10)
    .lean();

  return res.status(200).json({
    ...totals,
    trips: trips.map((t) => ({
      id: t._id.toString(),
      tripId: t.tripId,
      serviceDate: t.serviceDate,
      passengerName: t.passengerName,
      status: t.status,
      payStatus: t.payStatus,
      driverPay: t.driverPay,
      paidAt: t.paidAt,
      payReference: t.payReference,
      payHoldReason: t.payStatus === "held" ? t.payHoldReason : undefined,
      payDisputeReason: t.payStatus === "disputed" ? t.payDisputeReason : undefined,
    })),
    paymentHistory: paymentHistory.map((b) => ({
      id: b._id.toString(),
      paidAt: b.paidAt,
      amount: b.totalAmount,
      tripCount: b.tripCount,
      reference: b.referenceNumber,
    })),
  });
}
