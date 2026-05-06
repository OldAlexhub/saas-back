import NemtAgencyModel from "../models/NemtAgencySchema.js";
import NemtPaymentBatchModel from "../models/NemtPaymentBatchSchema.js";
import NemtTripModel from "../models/NemtTripSchema.js";
import DriverModel from "../models/DriverSchema.js";

// ---- Agency Billing ----

export async function listBillingBatches(req, res) {
  const { agencyId, status, page = "1", limit = "50" } = req.query;
  const filter = { batchType: "agency_billing" };
  if (agencyId) filter.agencyId = agencyId;
  if (status) filter.status = status;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [batches, total] = await Promise.all([
    NemtPaymentBatchModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
    NemtPaymentBatchModel.countDocuments(filter),
  ]);
  return res.status(200).json({ batches, total, page: pageNum, limit: limitNum });
}

export async function getBillingBatch(req, res) {
  const batch = await NemtPaymentBatchModel.findOne({
    _id: req.params.id,
    batchType: "agency_billing",
  }).lean();
  if (!batch) return res.status(404).json({ message: "Billing batch not found." });
  return res.status(200).json({ batch });
}

export async function createBillingBatch(req, res) {
  const { agencyId, tripIds, notes, referenceNumber } = req.body;

  const [agency, trips] = await Promise.all([
    NemtAgencyModel.findById(agencyId).lean(),
    NemtTripModel.find({
      _id: { $in: tripIds },
      billingStatus: "unbilled",
      status: "Completed",
    }).lean(),
  ]);

  if (!agency) return res.status(404).json({ message: "Agency not found." });
  if (trips.length === 0) {
    return res.status(400).json({ message: "No unbilled completed trips found for the provided IDs." });
  }

  const totalAmount = trips.reduce((sum, t) => sum + (t.agencyFare || 0), 0);
  const batch = new NemtPaymentBatchModel({
    batchType: "agency_billing",
    agencyId: agency._id,
    agencyName: agency.name,
    trips: trips.map((t) => t._id),
    tripCount: trips.length,
    totalAmount,
    status: "draft",
    billedAt: new Date(),
    notes,
    referenceNumber,
  });
  await batch.save();

  await NemtTripModel.updateMany(
    { _id: { $in: trips.map((t) => t._id) } },
    { $set: { billingStatus: "billed", billingBatchId: batch._id, billedAt: batch.billedAt } }
  );

  return res.status(201).json({ batch: batch.toObject() });
}

export async function updateBillingBatch(req, res) {
  const { status, paidAt, referenceNumber, notes } = req.body;
  const batch = await NemtPaymentBatchModel.findOne({
    _id: req.params.id,
    batchType: "agency_billing",
  });
  if (!batch) return res.status(404).json({ message: "Billing batch not found." });

  if (status !== undefined) batch.status = status;
  if (paidAt) batch.paidAt = new Date(paidAt);
  if (referenceNumber !== undefined) batch.referenceNumber = referenceNumber;
  if (notes !== undefined) batch.notes = notes;

  if (status === "paid") {
    const resolvedRef = referenceNumber ?? batch.referenceNumber;
    await NemtTripModel.updateMany(
      { billingBatchId: batch._id },
      {
        $set: {
          billingStatus: "paid",
          billingPaidAt: batch.paidAt || new Date(),
          billingReference: resolvedRef,
        },
      }
    );
  } else if (status === "disputed") {
    await NemtTripModel.updateMany({ billingBatchId: batch._id }, { $set: { billingStatus: "disputed" } });
  } else if (status === "cancelled") {
    await NemtTripModel.updateMany(
      { billingBatchId: batch._id },
      { $set: { billingStatus: "unbilled", billingBatchId: null, billedAt: null } }
    );
  }

  await batch.save();
  return res.status(200).json({ batch: batch.toObject() });
}

export async function getUnbilledTrips(req, res) {
  const { agencyId } = req.query;
  const filter = { billingStatus: "unbilled", status: "Completed" };
  if (agencyId) filter.agencyId = agencyId;
  const trips = await NemtTripModel.find(filter)
    .sort({ serviceDate: 1, scheduledPickupTime: 1 })
    .lean();
  return res.status(200).json({ trips, total: trips.length });
}

// ---- Driver Pay ----

export async function listPayBatches(req, res) {
  const { driverId, status, page = "1", limit = "50" } = req.query;
  const filter = { batchType: "driver_pay" };
  if (driverId) filter.driverId = driverId;
  if (status) filter.status = status;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [batches, total] = await Promise.all([
    NemtPaymentBatchModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
    NemtPaymentBatchModel.countDocuments(filter),
  ]);
  return res.status(200).json({ batches, total, page: pageNum, limit: limitNum });
}

export async function getPayBatch(req, res) {
  const batch = await NemtPaymentBatchModel.findOne({
    _id: req.params.id,
    batchType: "driver_pay",
  }).lean();
  if (!batch) return res.status(404).json({ message: "Pay batch not found." });
  return res.status(200).json({ batch });
}

export async function createPayBatch(req, res) {
  const { driverId, tripIds, notes, referenceNumber } = req.body;

  const [driver, trips] = await Promise.all([
    DriverModel.findOne({ driverId }).lean(),
    NemtTripModel.find({
      _id: { $in: tripIds },
      driverId,
      payStatus: "unpaid",
      status: "Completed",
    }).lean(),
  ]);

  if (!driver) return res.status(404).json({ message: "Driver not found." });
  if (trips.length === 0) {
    return res.status(400).json({ message: "No unpaid completed trips found for this driver." });
  }

  const totalAmount = trips.reduce((sum, t) => sum + (t.driverPay || 0), 0);
  const batch = new NemtPaymentBatchModel({
    batchType: "driver_pay",
    driverId,
    driverName: `${driver.firstName} ${driver.lastName}`,
    trips: trips.map((t) => t._id),
    tripCount: trips.length,
    totalAmount,
    status: "draft",
    notes,
    referenceNumber,
  });
  await batch.save();

  // Hold trips while batch is in draft
  await NemtTripModel.updateMany(
    { _id: { $in: trips.map((t) => t._id) } },
    { $set: { payStatus: "held", payBatchId: batch._id } }
  );

  return res.status(201).json({ batch: batch.toObject() });
}

export async function updatePayBatch(req, res) {
  const { status, paidAt, referenceNumber, notes } = req.body;
  const batch = await NemtPaymentBatchModel.findOne({
    _id: req.params.id,
    batchType: "driver_pay",
  });
  if (!batch) return res.status(404).json({ message: "Pay batch not found." });

  if (status !== undefined) batch.status = status;
  if (paidAt) batch.paidAt = new Date(paidAt);
  if (referenceNumber !== undefined) batch.referenceNumber = referenceNumber;
  if (notes !== undefined) batch.notes = notes;

  if (status === "paid") {
    const resolvedRef = referenceNumber ?? batch.referenceNumber;
    await NemtTripModel.updateMany(
      { payBatchId: batch._id },
      {
        $set: {
          payStatus: "paid",
          paidAt: batch.paidAt || new Date(),
          payReference: resolvedRef,
        },
      }
    );
  } else if (status === "disputed") {
    await NemtTripModel.updateMany({ payBatchId: batch._id }, { $set: { payStatus: "disputed" } });
  } else if (status === "cancelled") {
    // Release trips back to unpaid
    await NemtTripModel.updateMany(
      { payBatchId: batch._id },
      { $set: { payStatus: "unpaid", payBatchId: null } }
    );
  }

  await batch.save();
  return res.status(200).json({ batch: batch.toObject() });
}

export async function getUnpaidTrips(req, res) {
  const { driverId } = req.query;
  const filter = { payStatus: "unpaid", status: "Completed" };
  if (driverId) filter.driverId = driverId;

  // Exclude admin-only fare and billing fields from this response
  const trips = await NemtTripModel.find(filter)
    .select(
      "-agencyFare -agencyFareBasis -billingStatus -billingBatchId -billedAt -billingPaidAt -billingReference -internalNotes"
    )
    .sort({ serviceDate: 1, scheduledPickupTime: 1 })
    .lean();

  return res.status(200).json({ trips, total: trips.length });
}
