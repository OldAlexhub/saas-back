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

export default { queryReports };
