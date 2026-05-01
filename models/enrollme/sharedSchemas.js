import mongoose from "mongoose";

const { Schema } = mongoose;

export const signatureSchema = new Schema(
  {
    signerName: { type: String, trim: true },
    typedSignature: { type: String, trim: true },
    drawnSignature: { type: String },
    signedAt: { type: Date },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    device: { type: String, trim: true },
    documentVersion: { type: String, trim: true },
    acknowledgmentText: { type: String, trim: true },
    accepted: { type: Boolean, default: false },
  },
  { _id: false }
);

export const fileRefSchema = new Schema(
  {
    originalName: { type: String, trim: true },
    storedName: { type: String, trim: true },
    path: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "EnrollmeAdmin" },
    documentType: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { _id: true }
);

export const metadataSchema = new Schema(
  {
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    device: { type: String, trim: true },
    savedAt: { type: Date },
  },
  { _id: false }
);
