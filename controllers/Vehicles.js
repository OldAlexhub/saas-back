import fs from "fs/promises";
import mongoose from 'mongoose';
import path from "path";
import config from "../config/index.js";
import VehicleModel from "../models/VehicleSchema.js";

// Helper: some tests/mock setups replace model methods with plain async
// functions that return an object instead of a Query. When callers use
// `.lean()` we need to support both behaviors. This helper accepts the
// return value of a model call (usually a Query or a Promise or a doc)
// and resolves to the document.
async function resolveMaybeLean(resultOrQuery) {
  if (!resultOrQuery) return resultOrQuery;
  // If it's a Query-like object with lean(), call lean()
  try {
    if (typeof resultOrQuery.lean === "function") {
      return await resultOrQuery.lean();
    }
  } catch (e) {
    // fall through to awaiting as a promise
  }
  // If it's a promise-like, await it
  if (typeof resultOrQuery.then === "function") {
    return await resultOrQuery;
  }
  // Otherwise it's already a plain document
  return resultOrQuery;
}

// Upload a local file path or a buffer to GridFS and return the file document
async function uploadToGridFs({ localPath, buffer, filename, contentType, bucketName = 'fs' }) {
  const conn = mongoose.connection;
  const bucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName });

  return new Promise((resolve, reject) => {
    let uploadStream;
    if (buffer) {
      uploadStream = bucket.openUploadStream(filename || 'upload', { contentType });
      uploadStream.on('error', reject);
      uploadStream.on('finish', (file) => resolve(file));
      uploadStream.end(buffer);
    } else if (localPath) {
      const fs = require('fs');
      uploadStream = bucket.openUploadStream(filename || require('path').basename(localPath), { contentType });
      uploadStream.on('error', reject);
      uploadStream.on('finish', (file) => resolve(file));
      const rs = fs.createReadStream(localPath);
      rs.on('error', reject);
      rs.pipe(uploadStream);
    } else {
      reject(new Error('No source for upload'));
    }
  });
}

// Delete a GridFS file by id
async function deleteGridFsFile(gridFsId, bucketName = 'fs') {
  if (!gridFsId) return;
  try {
    const conn = mongoose.connection;
    const bucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName });
    const id = typeof gridFsId === 'string' ? new mongoose.Types.ObjectId(gridFsId) : gridFsId;
    await bucket.delete(id);
  } catch (err) {
    // if file already gone, ignore
    if (err && err.message && !/FileNotFound/.test(err.message)) {
      console.warn('deleteGridFsFile error', err.message);
    }
  }
}

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
    // If the record has a GridFS id, delete from GridFS
    if (record.gridFsId) {
      await deleteGridFsFile(record.gridFsId, record.bucketName || 'fs');
    }
    // Also attempt to delete any local file (if present)
    if (record.filename) {
      const fullPath = path.join(config.uploads.vehiclesDir, record.filename);
      await fs.unlink(fullPath).catch((err) => {
        if (err.code !== 'ENOENT') console.warn('Failed to remove old inspection file', err.message);
      });
    }
  } catch (err) {
    console.warn('Failed to remove old inspection file', err.message || err);
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
      // temporary set, will overwrite below if we upload to GridFS
      annualInspectionFile: buildFileRecord(req.file),
    });

    // If an upload was provided, upload to GridFS and update the record
    if (req.file) {
      try {
        const origName = req.file.originalname || req.file.filename || 'inspection-file';
        const mime = req.file.mimetype || 'application/octet-stream';
        let uploaded;
        if (req.file.path) {
          // multer wrote to disk
          uploaded = await uploadToGridFs({ localPath: req.file.path, filename: origName, contentType: mime });
          // remove the local file
          await fs.unlink(req.file.path).catch(() => {});
        } else if (req.file.buffer) {
          uploaded = await uploadToGridFs({ buffer: req.file.buffer, filename: origName, contentType: mime });
        }
        
        if (uploaded) {
          vehicle.annualInspectionFile = {
            gridFsId: uploaded._id,
            bucketName: uploaded.bucketName || 'fs',
            filename: uploaded.filename,
            originalName: origName,
            mimeType: mime,
            size: uploaded.length,
          };
        } else if (req.file && req.file.buffer) {
          // If GridFS upload didn't complete (e.g., test DB/environment),
          // fall back to writing the buffer to disk so the download endpoint
          // can serve the file. This keeps behavior consistent in tests.
          try {
            const ext = path.extname(origName || '') || '';
            const fname = `inspection-${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`;
            const fullPath = path.join(config.uploads.vehiclesDir, fname);
            await fs.writeFile(fullPath, req.file.buffer);
            vehicle.annualInspectionFile = {
              filename: fname,
              originalName: origName,
              mimeType: mime,
              size: req.file.size || (req.file.buffer && req.file.buffer.length) || 0,
            };
          } catch (fsErr) {
            console.error('Failed to write fallback inspection file to disk', fsErr);
          }
        }
      } catch (err) {
        console.error('Failed to upload inspection file to GridFS', err);
        return res.status(500).json({ message: 'Failed to store inspection file', error: err.message });
      }
    }

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
    const { cabNumber, cabNumbers } = _req.query || {};
    const query = {};
    // Helper: build case-insensitive exact-match regex for cab numbers
    function escapeRegex(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (cabNumber) {
      const key = String(cabNumber).trim();
      if (key) query.cabNumber = { $regex: `^${escapeRegex(key)}$`, $options: 'i' };
    } else if (cabNumbers) {
      const list = Array.isArray(cabNumbers)
        ? cabNumbers
        : String(cabNumbers)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      if (list.length) {
        query.$or = list.map((s) => ({ cabNumber: { $regex: `^${escapeRegex(String(s).trim())}$`, $options: 'i' } }));
      }
    }

    const vehicles = await VehicleModel.find(query).lean();
    return res.status(200).json({
      count: vehicles.length,
      vehicles,
    });
  } catch (error) {
    console.error("Failed to list vehicles:", error);
    return res.status(500).json({ message: "Failed to fetch vehicles", error: error.message });
  }
};

// Batch lookup: accept JSON body { cabNumbers: ["A1","B2"] } and return matching vehicles
export const listVehiclesByCabs = async (req, res) => {
  try {
    const { cabNumbers } = req.body || {};
    const list = Array.isArray(cabNumbers)
      ? cabNumbers.map((s) => String(s).trim()).filter(Boolean)
      : [];
    if (!list.length) {
      return res.status(400).json({ message: 'cabNumbers array is required' });
    }

    function escapeRegex(s) {
      return s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
    }

    const query = { $or: list.map((s) => ({ cabNumber: { $regex: `^${escapeRegex(String(s))}$`, $options: 'i' } })) };

    const vehicles = await VehicleModel.find(query).lean();

    const byCab = {};
    for (const v of Array.isArray(vehicles) ? vehicles : []) {
      if (v && v.cabNumber) byCab[String(v.cabNumber).trim()] = v;
    }

    return res.status(200).json({ count: vehicles.length, vehicles, byCab });
  } catch (error) {
    console.error('Failed to list vehicles by cabs:', error);
    return res.status(500).json({ message: 'Failed to fetch vehicles', error: error.message });
  }
};

// Fetch single vehicle by id
export const getVehicle = async (req, res) => {
  try {
    const { id } = req.params;
  const vehicle = await resolveMaybeLean(VehicleModel.findById(id));
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
  const vehicle = await resolveMaybeLean(VehicleModel.findById(id));
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    const record = vehicle.annualInspectionFile;
    if (!record || !record.filename) return res.status(404).json({ message: 'Inspection file not found for vehicle' });
    // If the record references GridFS, stream from MongoDB GridFSBucket
    if (record.gridFsId) {
      try {
        const conn = mongoose.connection;
        const bucketName = record.bucketName || 'fs';
        const bucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName });

        const filename = record.originalName || record.filename || 'inspection-file';
        const mimeType = record.mimeType || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        const objectId = typeof record.gridFsId === 'string' ? new mongoose.Types.ObjectId(record.gridFsId) : record.gridFsId;
        const downloadStream = bucket.openDownloadStream(objectId);
        downloadStream.on('error', (err) => {
          console.error('GridFS download error', err);
          if (!res.headersSent) res.status(500).json({ message: 'Failed to download file' });
        });
        return downloadStream.pipe(res);
      } catch (err) {
        console.error('Failed to stream from GridFS', err);
        return res.status(500).json({ message: 'Failed to download inspection file', error: err.message });
      }
    }

    // Fallback to disk-based storage (existing behavior)
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
