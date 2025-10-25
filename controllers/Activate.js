// controllers/activeController.js
import ActiveModel from "../models/ActiveSchema.js";
import { COMPANY_ID, CompanyModel } from "../models/CompanySchema.js";
import DriverModel from "../models/DriverSchema.js";
import VehicleModel from "../models/VehicleSchema.js";
import { diffChanges } from "../utils/diff.js";

// Whitelist of fields that can be created/updated from client
const ALLOWED_FIELDS = new Set([
  "driverId",
  "cabNumber",
  "firstName",
  "lastName",
  "licPlates",
  "make",
  "model",
  "color",
  "status",          // 'Active' | 'Inactive'
  "availability",    // 'Online' | 'Offline'
  "currentLocation", // { type: 'Point', coordinates: [lng, lat], updatedAt }
  "hoursOfService",  // object (all numeric/time values maintained by frontend)
]);

/**
 * Normalize location input:
 * - Accepts either:
 *    currentLocation: { type:'Point', coordinates:[lng,lat], updatedAt? }
 *   OR
 *    lat, lng (numbers) in the payload (we'll convert to GeoJSON Point).
 * - Returns { currentLocation?: { type, coordinates, updatedAt } }
 */
function pickAndNormalizeLocation(body) {
  const out = {};
  if (
    body.currentLocation &&
    Array.isArray(body.currentLocation.coordinates) &&
    body.currentLocation.coordinates.length === 2
  ) {
    const [lng, lat] = body.currentLocation.coordinates.map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      out.currentLocation = {
        type: "Point",
        coordinates: [lng, lat],
        updatedAt: body.currentLocation.updatedAt
          ? new Date(body.currentLocation.updatedAt)
          : new Date(),
      };
    }
  } else if (
    Object.prototype.hasOwnProperty.call(body, "lat") &&
    Object.prototype.hasOwnProperty.call(body, "lng")
  ) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out.currentLocation = {
        type: "Point",
        coordinates: [lng, lat],
        updatedAt: new Date(),
      };
    }
  }
  return out;
}

/**
 * Utility: pick only allowed fields from body (shallow)
 */
function pickAllowed(body) {
  const picked = {};
  for (const key of Object.keys(body || {})) {
    if (ALLOWED_FIELDS.has(key)) picked[key] = body[key];
  }
  return picked;
}

/**
 * CREATE (Add Active)
 * - Creates a new active record
 * - Status & availability follow schema defaults unless provided
 * - Optionally accepts location via body.currentLocation or lat/lng
 * - Optional: prevent duplicates by driverId or cabNumber if desired
 */
export const addActive = async (req, res) => {
  try {
    const base = pickAllowed(req.body);
    const loc = pickAndNormalizeLocation(req.body);

    const payload = {
      ...base,
      ...loc,
    };

    if (!payload.driverId || !payload.cabNumber) {
      return res
        .status(400)
        .json({ message: "driverId and cabNumber are required to create an active assignment." });
    }

    payload.driverId = String(payload.driverId).trim();
    payload.cabNumber = String(payload.cabNumber).trim();

    const driverDoc = await DriverModel.findOne({ driverId: payload.driverId });
    if (!driverDoc) {
      return res.status(404).json({ message: `Driver ${payload.driverId} was not found.` });
    }

    const vehicleDoc = await VehicleModel.findOne({ cabNumber: payload.cabNumber });
    if (!vehicleDoc) {
      return res.status(404).json({ message: `Vehicle ${payload.cabNumber} was not found.` });
    }

    const conflict = await ActiveModel.findOne({
      $or: [{ driverId: payload.driverId }, { cabNumber: payload.cabNumber }],
    });
    if (conflict) {
      return res.status(409).json({
        message: "Driver and vehicle must be uniquely assigned. Another active record already uses one of these.",
      });
    }

    payload.firstName = driverDoc.firstName;
    payload.lastName = driverDoc.lastName;
    payload.licPlates = vehicleDoc.licPlates;
    payload.make = vehicleDoc.make;
    payload.model = vehicleDoc.model;
    payload.color = vehicleDoc.color;
    payload.cabNumber = vehicleDoc.cabNumber;

    // Populate vehicle compliance snapshot on the active record
    payload.regisExpiry = vehicleDoc.regisExpiry || null;
    payload.annualInspection = vehicleDoc.annualInspection || null;
    const now = new Date();
    const complianceIssues = [];
    // Missing dates are treated as compliance issues so UI and guards surface them
    if (!vehicleDoc.regisExpiry) {
      complianceIssues.push("registrationMissing");
    } else if (new Date(vehicleDoc.regisExpiry) < now) {
      complianceIssues.push("registrationExpired");
    }
    if (!vehicleDoc.annualInspection) {
      complianceIssues.push("inspectionMissing");
    } else if (vehicleDoc.annualInspection && new Date(vehicleDoc.annualInspection) < now) {
      complianceIssues.push("inspectionExpired");
    }
    payload.vehicleCompliance = {
      isCompliant: complianceIssues.length === 0,
      issues: complianceIssues,
    };

    // Optional duplicate guardrails (uncomment if you want to enforce uniqueness)
    // const existing = await ActiveModel.findOne({
    //   $or: [{ driverId: payload.driverId }, { cabNumber: payload.cabNumber }],
    // });
    // if (existing) {
    //   return res.status(409).json({ message: "DriverId or CabNumber already exists in actives." });
    // }

    const doc = new ActiveModel(payload);
    await doc.save(); // schema-level validation applies

    return res.status(201).json({
      message: "Active driver added successfully",
      data: doc,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error adding active driver",
      error: error.message,
    });
  }
};

/**
 * UPDATE (Any field + status toggle + online/offline + HOS + location)
 * - Applies only whitelisted fields
 * - Normalizes/accepts lat/lng into GeoJSON
 * - Builds a granular history entry with field diffs
 * - Uses .save() to ensure validations & defaults are enforced
 */
export const updateActive = async (req, res) => {
  try {
    const { id } = req.params;
    const changedBy = req.user?.id || "system"; // attach your auth user id/email if available
    const note = req.body?.note || null; // optional reason/comment from client

    const existing = await ActiveModel.findById(id);
    if (!existing) {
      return res.status(404).json({ message: "Record not found" });
    }

    const baseUpdates = pickAllowed(req.body);
    const loc = pickAndNormalizeLocation(req.body);

    const nextDriverId =
      baseUpdates.driverId !== undefined
        ? String(baseUpdates.driverId).trim()
        : existing.driverId;
    const nextCabNumber =
      baseUpdates.cabNumber !== undefined
        ? String(baseUpdates.cabNumber).trim()
        : existing.cabNumber;

    if (!nextDriverId || !nextCabNumber) {
      return res
        .status(400)
        .json({ message: "driverId and cabNumber are required to keep a driver active." });
    }

    const driverDoc = await DriverModel.findOne({ driverId: nextDriverId });
    if (!driverDoc) {
      return res.status(404).json({ message: `Driver ${nextDriverId} was not found.` });
    }

    const vehicleDoc = await VehicleModel.findOne({ cabNumber: nextCabNumber });
    if (!vehicleDoc) {
      return res.status(404).json({ message: `Vehicle ${nextCabNumber} was not found.` });
    }

    if (nextDriverId !== existing.driverId) {
      const driverConflict = await ActiveModel.findOne({
        driverId: nextDriverId,
        _id: { $ne: existing._id },
      });
      if (driverConflict) {
        return res.status(409).json({
          message: "That driver is already paired with another vehicle. Resolve the existing record first.",
        });
      }
    }

    if (nextCabNumber !== existing.cabNumber) {
      const vehicleConflict = await ActiveModel.findOne({
        cabNumber: nextCabNumber,
        _id: { $ne: existing._id },
      });
      if (vehicleConflict) {
        return res.status(409).json({
          message: "That vehicle is already paired with a driver. Resolve the existing record first.",
        });
      }
    }

    baseUpdates.driverId = nextDriverId;
    baseUpdates.cabNumber = vehicleDoc.cabNumber;
    baseUpdates.firstName = driverDoc.firstName;
    baseUpdates.lastName = driverDoc.lastName;
    baseUpdates.licPlates = vehicleDoc.licPlates;
    baseUpdates.make = vehicleDoc.make;
    baseUpdates.model = vehicleDoc.model;
    baseUpdates.color = vehicleDoc.color;
    // Keep compliance snapshot up-to-date when vehicle assignment changes
    baseUpdates.regisExpiry = vehicleDoc.regisExpiry || null;
    baseUpdates.annualInspection = vehicleDoc.annualInspection || null;
    const now2 = new Date();
    const complianceIssues2 = [];
    if (!vehicleDoc.regisExpiry) {
      complianceIssues2.push("registrationMissing");
    } else if (new Date(vehicleDoc.regisExpiry) < now2) {
      complianceIssues2.push("registrationExpired");
    }
    if (!vehicleDoc.annualInspection) {
      complianceIssues2.push("inspectionMissing");
    } else if (vehicleDoc.annualInspection && new Date(vehicleDoc.annualInspection) < now2) {
      complianceIssues2.push("inspectionExpired");
    }
    baseUpdates.vehicleCompliance = {
      isCompliant: complianceIssues2.length === 0,
      issues: complianceIssues2,
    };

    const nextState = {
      ...existing.toObject(),
      ...baseUpdates,
      ...(loc.currentLocation ? { currentLocation: loc.currentLocation } : {}),
    };

    const changes = diffChanges(existing.toObject(), nextState);

    Object.assign(existing, baseUpdates);
    if (loc.currentLocation) {
      existing.currentLocation = loc.currentLocation;
    }

    if (changes.length > 0) {
      existing.history.push({
        changedBy,
        note,
        changes,
        changedAt: new Date(),
      });
    }

    const updated = await existing.save();

    return res.status(200).json({
      message: "Record updated successfully",
      data: updated,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error updating record",
      error: error.message,
    });
  }
};

/**
 * OPTIONAL: Dedicated endpoints for status & availability toggles
 * These ensure concise, intention-revealing APIs for the app.
 */

export const setStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body; // 'Active' | 'Inactive'
    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const existing = await ActiveModel.findById(id);
    if (!existing) return res.status(404).json({ message: "Record not found" });

    if (status === "Active") {
      if (!existing.driverId || !existing.cabNumber) {
        return res.status(400).json({
          message: "Assign both a driver and vehicle before marking a record as Active.",
        });
      }
      const [driverDoc, vehicleDoc] = await Promise.all([
        DriverModel.findOne({ driverId: existing.driverId }),
        VehicleModel.findOne({ cabNumber: existing.cabNumber }),
      ]);
      if (!driverDoc || !vehicleDoc) {
        return res.status(400).json({
          message: "Active status requires a valid driver/vehicle pairing. Resolve missing records first.",
        });
      }
      // Enforce simple compliance checks before allowing Active status
      const now = new Date();
      const issues = [];
      if (!vehicleDoc.regisExpiry) issues.push('registrationMissing');
      else if (new Date(vehicleDoc.regisExpiry) < now) issues.push('registrationExpired');
      if (!vehicleDoc.annualInspection) issues.push('inspectionMissing');
      else if (vehicleDoc.annualInspection && new Date(vehicleDoc.annualInspection) < now) issues.push('inspectionExpired');
      if (issues.length > 0) {
        return res.status(400).json({
          message: "Vehicle compliance check failed. Resolve vehicle registration/inspection issues before activating.",
          issues,
        });
      }
    }

    const prev = existing.status;
    if (prev !== status) {
      existing.status = status;
      existing.history.push({
        changedBy: req.user?.id || "system",
        note: note || null,
        changes: [{ field: "status", oldValue: prev, newValue: status }],
        changedAt: new Date(),
      });
    }

    const saved = await existing.save();
    return res.status(200).json({ message: "Status updated", data: saved });
  } catch (error) {
    return res.status(500).json({ message: "Error updating status", error: error.message });
  }
};

export const setAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { availability, note } = req.body; // 'Online' | 'Offline'
    if (!["Online", "Offline"].includes(availability)) {
      return res.status(400).json({ message: "Invalid availability value." });
    }

    const existing = await ActiveModel.findById(id);
    if (!existing) return res.status(404).json({ message: "Record not found" });

    if (availability === "Online") {
      if (existing.status !== "Active") {
        return res
          .status(400)
          .json({ message: "Driver must be marked Active before they can go Online." });
      }
      if (!existing.driverId || !existing.cabNumber) {
        return res.status(400).json({
          message: "Assign both a driver and vehicle before setting availability to Online.",
        });
      }
      const [driverDoc, vehicleDoc] = await Promise.all([
        DriverModel.findOne({ driverId: existing.driverId }),
        VehicleModel.findOne({ cabNumber: existing.cabNumber }),
      ]);
      if (!driverDoc || !vehicleDoc) {
        return res.status(400).json({
          message: "Valid driver and vehicle records are required before going Online.",
        });
      }
      // Enforce vehicle compliance before allowing Online availability
      const now3 = new Date();
      const issues3 = [];
      if (!vehicleDoc.regisExpiry) issues3.push('registrationMissing');
      else if (new Date(vehicleDoc.regisExpiry) < now3) issues3.push('registrationExpired');
      if (!vehicleDoc.annualInspection) issues3.push('inspectionMissing');
      else if (vehicleDoc.annualInspection && new Date(vehicleDoc.annualInspection) < now3) issues3.push('inspectionExpired');
      if (issues3.length > 0) {
        return res.status(400).json({
          message: "Vehicle compliance check failed. Resolve vehicle registration/inspection issues before going Online.",
          issues: issues3,
        });
      }
    }

    const prev = existing.availability;
    if (prev !== availability) {
      existing.availability = availability;
      existing.history.push({
        changedBy: req.user?.id || "system",
        note: note || null,
        changes: [{ field: "availability", oldValue: prev, newValue: availability }],
        changedAt: new Date(),
      });
    }

    const saved = await existing.save();
    return res.status(200).json({ message: "Availability updated", data: saved });
  } catch (error) {
    return res.status(500).json({ message: "Error updating availability", error: error.message });
  }
};


// ----------------------
// GET ALL ACTIVES (with filters + optional proximity)
// ----------------------
export const getAllActives = async (req, res) => {
  try {
    const { status, availability, lat, lng, radius } = req.query;

    // Build filters
    const query = {};
    if (status) query.status = status;
    if (availability) query.availability = availability;

    // If location & radius provided → add proximity filter. Clamp any client
    // provided radius to the company-configured maxDistanceMiles to ensure the
    // search respects company dispatch settings (defense in depth).
    if (lat && lng && radius) {
      const requested = Number.parseFloat(radius);
      // Load company dispatch settings (best-effort). If unavailable, fall
      // back to a sensible default (6 miles ≈ 9656 m).
      let maxDistanceMeters = Math.round(6 * 1609.34);
      try {
        const company = await CompanyModel.findById(COMPANY_ID).lean();
        const configuredMiles = company?.dispatchSettings?.maxDistanceMiles;
        if (Number.isFinite(Number(configuredMiles))) {
          maxDistanceMeters = Math.round(Number(configuredMiles) * 1609.34);
        }
      } catch (_e) {
        // ignore and use default
      }

      const usedRadius = Number.isFinite(requested) ? Math.min(requested, maxDistanceMeters) : maxDistanceMeters;
      if (Number.isFinite(requested) && usedRadius < requested) {
        // eslint-disable-next-line no-console
        console.debug(`Clamped requested radius ${requested}m to company max ${maxDistanceMeters}m`);
      }

      query.currentLocation = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: usedRadius, // in meters (clamped)
        },
      };
    }

    const results = await ActiveModel.find(query);

    res.status(200).json({
      count: results.length,
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error fetching active drivers",
      error: error.message,
    });
  }
};

// ----------------------
// GET SINGLE ACTIVE BY ID
// ----------------------
export const getActiveById = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await ActiveModel.findById(id);
    if (!record)
      return res.status(404).json({ message: "Active driver not found" });

    res.status(200).json(record);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching active driver",
      error: error.message,
    });
  }
};
