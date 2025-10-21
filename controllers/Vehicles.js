import fs from "fs/promises";
import path from "path";
import config from "../config/index.js";
import VehicleModel from "../models/VehicleSchema.js";

function buildFileRecord(file) {
  if (!file) return undefined;
  return {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url: `/uploads/vehicles/${file.filename}`,
  };
}

async function removeOldFile(record) {
  if (!record?.filename) return;
  try {
    const fullPath = path.join(config.uploads.vehiclesDir, record.filename);
    await fs.unlink(fullPath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("Failed to remove old inspection file", err.message);
    }
  }
}

// Add a new vehicle
export const addVehicle = async (req, res) => {
  try {
    const {
      cabNumber,
      vinNumber,
      licPlates,
      regisExpiry,
      annualInspection,
      make,
      model,
      year,
      color,
    } = req.body;

    if (!cabNumber || !vinNumber || !licPlates || !regisExpiry || !year) {
      return res.status(400).json({ message: "cabNumber, vinNumber, licPlates, regisExpiry and year are required." });
    }

    const existing = await VehicleModel.findOne({
      $or: [{ cabNumber }, { vinNumber }, { licPlates }],
    });
    if (existing) {
      return res.status(409).json({ message: "Vehicle already exists with provided identifiers." });
    }

    const vehicle = new VehicleModel({
      cabNumber,
      vinNumber,
      licPlates,
      regisExpiry,
      annualInspection,
      make,
      model,
      year,
      color,
      annualInspectionFile: buildFileRecord(req.file),
    });

    await vehicle.save();

    res.status(201).json({
      message: "Vehicle added successfully",
      vehicle,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to add vehicle", error: error.message });
  }
};

// Update vehicle + record history
export const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const editor = (req.user && (req.user.email || req.user.id)) || "system";

    const vehicle = await VehicleModel.findById(id);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

    const fields = [
      "cabNumber",
      "vinNumber",
      "licPlates",
      "regisExpiry",
      "annualInspection",
      "make",
      "model",
      "year",
      "color",
    ];

    const updates = {};
    for (const f of fields) {
      if (f in req.body) updates[f] = req.body[f];
    }

    if (req.file) {
      await removeOldFile(vehicle.annualInspectionFile);
      updates.annualInspectionFile = buildFileRecord(req.file);
    }

    const changes = {};
    for (const key of Object.keys(updates)) {
      const newVal = updates[key];
      const oldVal = vehicle[key];
      const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
      if (changed) {
        changes[key] = {
          from: oldVal,
          to: newVal,
        };
        vehicle[key] = newVal;
      }
    }

    if (Object.keys(changes).length === 0) {
      return res.status(200).json({ message: "No changes detected", vehicle });
    }

    vehicle.history.push({ at: new Date(), by: editor, changes });

    await vehicle.save();
    res.status(200).json({ message: "Vehicle updated successfully", vehicle });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update vehicle", error: error.message });
  }
};

// Fetch all vehicles
export const listVehicles = async (_req, res) => {
  try {
    const vehicles = await VehicleModel.find().lean();
    return res.status(200).json({
      count: vehicles.length,
      vehicles,
    });
  } catch (error) {
    console.error("Failed to list vehicles:", error);
    return res.status(500).json({ message: "Failed to fetch vehicles", error: error.message });
  }
};

// Fetch single vehicle by id
export const getVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const vehicle = await VehicleModel.findById(id).lean();
    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }
    return res.status(200).json({ vehicle });
  } catch (error) {
    console.error("Failed to fetch vehicle:", error);
    return res.status(500).json({ message: "Failed to fetch vehicle", error: error.message });
  }
};

// Authenticated download of a single vehicle's inspection file
export const downloadInspectionFile = async (req, res) => {
  try {
    const { id } = req.params;
    const vehicle = await VehicleModel.findById(id).lean();
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    const record = vehicle.annualInspectionFile;
    if (!record || !record.filename) return res.status(404).json({ message: 'Inspection file not found for vehicle' });

    const fullPath = path.join(config.uploads.vehiclesDir, record.filename);
    // Use fs.promises.stat to check existence
    try {
      await fs.stat(fullPath);
    } catch (err) {
      return res.status(404).json({ message: 'Inspection file not available on disk' });
    }

    // Stream the file as an attachment with original filename
    return res.download(fullPath, record.originalName || record.filename, (err) => {
      if (err) {
        console.error('Failed to send inspection file', err);
        if (!res.headersSent) return res.status(500).json({ message: 'Failed to send file' });
      }
    });
  } catch (error) {
    console.error('Error in downloadInspectionFile', error);
    return res.status(500).json({ message: 'Failed to download inspection file', error: error.message });
  }
};
