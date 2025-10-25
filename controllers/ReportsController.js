import mongoose from 'mongoose';
import ActiveModel from '../models/ActiveSchema.js';
import BookingModel from '../models/BookingSchema.js';
import DriverLocationTimelineModel from '../models/DriverLocationTimeline.js';
import DriverModel from '../models/DriverSchema.js';
import { FareModel } from '../models/FareSchema.js';
import VehicleModel from '../models/VehicleSchema.js';

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

function resolveModel(name) {
  return MODEL_MAP[name];
}

function pickFields(prefix, fields = []) {
  // build projection object where keys are prefixed to avoid collisions
  const proj = {};
  if (!fields || !fields.length) return proj;
  for (const f of fields) {
    proj[f] = 1;
  }
  return proj;
}

export async function queryReports(req, res) {
  try {
    // Emit a lightweight deprecation/diagnostic header so callers can detect legacy usage.
    // This does not change behavior; it only signals the endpoint is legacy and may be
    // removed in the future. Toggle via LEGACY_REPORTS_DEPRECATE=true to make the
    // server log a stronger warning on each call.
    try {
      res.setHeader('X-Legacy-Reports', 'true');
      if (process.env.LEGACY_REPORTS_DEPRECATE === 'true') {
        console.warn('Legacy reports endpoint /api/reports/query was invoked — consider migrating callers to the new reporting APIs.');
      }
    } catch (_err) {
      // ignore failures setting headers in some hosting environments
    }
    const { left, right, leftKey, rightKey, fields = {}, limit = 500 } = req.body || {};

    if (!left || !right || !leftKey || !rightKey) {
      return res.status(400).json({ message: 'left,right,leftKey and rightKey are required' });
    }

    const leftModel = resolveModel(left);
    const rightModel = resolveModel(right);
    if (!leftModel || !rightModel) {
      return res.status(400).json({ message: 'Unknown dataset name' });
    }

    // Basic aggregation pipeline: lookup right collection by matching left[leftKey] to right[rightKey]
    // We assume that the right collection stores the join key as string/number comparable to left.
    const pipeline = [];

    // Optionally limit early to keep results small
    if (Number(limit) > 0) pipeline.push({ $limit: Number(limit) });

    pipeline.push({
      $lookup: {
        from: rightModel.collection.name,
        localField: leftKey,
        foreignField: rightKey,
        as: '__right',
      },
    });

    // unwind right to produce one row per match (inner join)
    pipeline.push({ $unwind: '$__right' });

    // Project requested fields
    const leftFields = (fields.left || []).reduce((acc, f) => ({ ...acc, [f]: `$${f}` }), {});
    const rightFields = (fields.right || []).reduce((acc, f) => ({ ...acc, [`__right.${f}`]: `$__right.${f}` }), {});
    const project = { _id: 0, ...leftFields, ...rightFields };

    // If no fields requested, default to full left and right objects flattened
    if (Object.keys(project).length === 1) {
      pipeline.push({ $addFields: { __right: '$__right' } });
      pipeline.push({ $project: { _id: 0, left: '$$ROOT', right: '$__right' } });
    } else {
      pipeline.push({ $project: project });
    }

    const results = await leftModel.aggregate(pipeline).allowDiskUse(true).exec();

    return res.json({ data: results });
  } catch (err) {
    console.error('Reports query error', err);
    return res.status(500).json({ message: 'Unable to run report query', error: String(err) });
  }
}

export async function incomePerDriver(req, res) {
  try {
    // Query params: from, to (ISO dates), driverId (optional), limit (optional)
    const { from, to, driverId } = req.query || {};
    let limit = Number(req.query?.limit || 100);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;

    // match completed bookings only
    const match = { status: 'Completed' };

    // Build date range on completedAt
    if (from || to) {
      match.completedAt = {};
      if (from) {
        const f = new Date(from);
        if (!Number.isNaN(f.getTime())) match.completedAt.$gte = f;
      }
      if (to) {
        const t = new Date(to);
        if (!Number.isNaN(t.getTime())) match.completedAt.$lte = t;
      }
      // if completedAt became empty (invalid dates), remove it
      if (Object.keys(match.completedAt).length === 0) delete match.completedAt;
    }

    if (driverId) {
      // match driverId or null/empty as provided by client
      match.driverId = String(driverId);
    }

    const pipeline = [];
    pipeline.push({ $match: match });

    // Compute a numeric base fare (finalFare, fallback to estimatedFare or flatRateAmount)
    pipeline.push({
      $addFields: {
        __fareBase: {
          $ifNull: [
            '$finalFare',
            { $ifNull: ['$estimatedFare', '$flatRateAmount'] },
          ],
        },
      },
    });

    // Sum appliedFees amounts safely
    pipeline.push({
      $addFields: {
        __feesTotal: {
          $reduce: {
            input: { $ifNull: ['$appliedFees', []] },
            initialValue: 0,
            in: { $add: ['$$value', { $ifNull: ['$$this.amount', 0] }] },
          },
        },
      },
    });

    // Total for each booking
    pipeline.push({
      $addFields: {
        __totalFare: { $add: [{ $ifNull: ['$__fareBase', 0] }, { $ifNull: ['$__feesTotal', 0] }] },
      },
    });

    // Group by driverId (coalesce missing driver to 'unassigned')
    pipeline.push({
      $group: {
        _id: { $ifNull: ['$driverId', 'unassigned'] },
        trips: { $sum: 1 },
        total: { $sum: '$__totalFare' },
        avg: { $avg: '$__totalFare' },
      },
    });

    // Lookup driver metadata (by driverId -> drivers.driverId)
    pipeline.push({
      $lookup: {
        from: resolveModel('drivers').collection.name,
        localField: '_id',
        foreignField: 'driverId',
        as: '__driver',
      },
    });

    pipeline.push({ $unwind: { path: '$__driver', preserveNullAndEmptyArrays: true } });

    // Final projection
    pipeline.push({
      $project: {
        _id: 0,
        driverId: '$_id',
        name: {
          $cond: {
            if: { $gt: [{ $size: { $ifNull: ['$__driver.firstName', []] } }, 0] },
            then: { $concat: [{ $ifNull: ['$__driver.firstName', ''] }, ' ', { $ifNull: ['$__driver.lastName', ''] }] },
            else: { $ifNull: ['$__driver.email', 'Unassigned'] },
          },
        },
        trips: 1,
        total: { $round: ['$total', 2] },
        avg: { $round: ['$avg', 2] },
      },
    });

    pipeline.push({ $sort: { total: -1 } });
    if (limit && Number(limit) > 0) pipeline.push({ $limit: Number(limit) });

    const results = await BookingModel.aggregate(pipeline).allowDiskUse(true).exec();

    return res.json({ data: results });
  } catch (err) {
    console.error('Income-per-driver report error', err);
    return res.status(500).json({ message: 'Unable to run income-per-driver report', error: String(err) });
  }
}

export default { queryReports, incomePerDriver };
