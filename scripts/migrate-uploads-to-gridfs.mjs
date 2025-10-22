#!/usr/bin/env node
import dotenv from 'dotenv';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import mongoose from 'mongoose';
import path from 'path';
dotenv.config();

import config from '../config/index.js';
import VehicleModel from '../models/VehicleSchema.js';

async function uploadToGridFs(conn, localPath, filename, contentType, bucketName = 'fs') {
  const bucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName });
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, { contentType });
    uploadStream.on('error', reject);
    uploadStream.on('finish', (file) => resolve(file));
    createReadStream(localPath).pipe(uploadStream);
  });
}

async function run() {
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) throw new Error('MONGO_URL required');
  await mongoose.connect(mongoUrl);
  const conn = mongoose.connection;
  console.log('Connected to mongo');

  const uploadsDir = config.uploads.vehiclesDir;
  console.log('Scanning uploads dir:', uploadsDir);

  const vehicles = await VehicleModel.find({ 'annualInspectionFile.filename': { $exists: true } }).lean();
  console.log('Found', vehicles.length, 'vehicles with filenames');

  for (const v of vehicles) {
    const record = v.annualInspectionFile;
    if (!record || !record.filename) continue;
    // skip if already has gridFsId
    if (record.gridFsId) {
      console.log('Skipping', v._id, 'already in GridFS');
      continue;
    }
    const fullPath = path.join(uploadsDir, record.filename);
    try {
      await fs.access(fullPath);
    } catch (err) {
      console.warn('File not found on disk for', v._id, fullPath);
      continue;
    }
    console.log('Uploading', fullPath);
    const uploaded = await uploadToGridFs(conn, fullPath, record.originalName || record.filename, record.mimeType || 'application/octet-stream');
    console.log('Uploaded to GridFS id=', uploaded._id.toString());
    // update vehicle doc
    await VehicleModel.updateOne({ _id: v._id }, { $set: { 'annualInspectionFile.gridFsId': uploaded._id, 'annualInspectionFile.bucketName': 'fs', 'annualInspectionFile.filename': uploaded.filename, 'annualInspectionFile.size': uploaded.length } });
    // optionally remove local file
    try { await fs.unlink(fullPath); } catch (e) {}
  }

  console.log('Done');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
