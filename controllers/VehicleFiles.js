import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import config from '../config/index.js';
import ActiveModel from '../models/ActiveSchema.js';
import VehicleModel from '../models/VehicleSchema.js';

// List vehicle files, optionally filtered by driverId or cabNumber
export const listVehicleFiles = async (req, res) => {
  try {
    const { driverId, cabNumber } = req.query;

    const cabNumbers = [];
    if (cabNumber) cabNumbers.push(String(cabNumber));
    if (driverId) {
      // find actives for this driverId and collect their cabNumbers
      const actives = await ActiveModel.find({ driverId: String(driverId) }).lean();
      for (const a of actives) {
        if (a.cabNumber) cabNumbers.push(a.cabNumber);
      }
    }

    const vehicles = cabNumbers.length
      ? await VehicleModel.find({ cabNumber: { $in: cabNumbers } }).lean()
      : await VehicleModel.find().lean();
    const files = [];
    for (const v of vehicles) {
      if (v.annualInspectionFile && v.annualInspectionFile.filename) {
        const filePath = path.join(config.uploads.vehiclesDir, v.annualInspectionFile.filename);
        const available = fs.existsSync(filePath);
        files.push({
          vehicleId: v._id,
          cabNumber: v.cabNumber,
          filename: v.annualInspectionFile.filename,
          originalName: v.annualInspectionFile.originalName,
          mimeType: v.annualInspectionFile.mimeType,
          size: v.annualInspectionFile.size,
          url: v.annualInspectionFile.url,
          available,
        });
      }
    }
    return res.status(200).json({ count: files.length, files });
  } catch (err) {
    console.error('Failed to list vehicle files', err);
    return res.status(500).json({ message: 'Failed to list vehicle files', error: err.message });
  }
};

// Download a batch (zip) of vehicle files, optionally filtered by cabNumber
export const downloadVehicleFilesZip = async (req, res) => {
  try {
    const { cabNumber, driverId } = req.query;

    const cabNumbers = [];
    if (cabNumber) cabNumbers.push(String(cabNumber));
    if (driverId) {
      const actives = await ActiveModel.find({ driverId: String(driverId) }).lean();
      for (const a of actives) if (a.cabNumber) cabNumbers.push(a.cabNumber);
    }

    const vehicles = cabNumbers.length
      ? await VehicleModel.find({ cabNumber: { $in: cabNumbers } }).lean()
      : await VehicleModel.find().lean();

    // Set headers for zip
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=vehicle-files${cabNumber ? `-${cabNumber}` : ''}.zip`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('Archiver error', err);
      try { res.status(500).end(); } catch (e) {}
    });

    archive.pipe(res);

    for (const v of vehicles) {
      if (v.annualInspectionFile && v.annualInspectionFile.filename) {
        const filePath = path.join(config.uploads.vehiclesDir, v.annualInspectionFile.filename);
        if (fs.existsSync(filePath)) {
          const name = `${v.cabNumber || v._id}-${v.annualInspectionFile.originalName || v.annualInspectionFile.filename}`;
          archive.file(filePath, { name });
        }
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Failed to create vehicle files zip', err);
    return res.status(500).json({ message: 'Failed to create zip', error: err.message });
  }
};
