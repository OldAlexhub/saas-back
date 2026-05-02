import mongoose from "mongoose";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

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
    documentType: { type: String, trim: true },
    documentTitle: { type: String, trim: true },
    effectiveDate: { type: Date },
    generatedAt: { type: Date },
    reviewedAt: { type: Date },
    acknowledgmentText: { type: String, trim: true },
    electronicSignatureConsent: { type: Boolean, default: false },
    dataSnapshot: { type: Mixed },
    contentSnapshot: { type: String },
    contentHash: { type: String, trim: true },
    accepted: { type: Boolean, default: false },
  },
  { _id: false }
);

export const documentReviewEventSchema = new Schema(
  {
    documentType: { type: String, required: true, trim: true },
    documentTitle: { type: String, trim: true },
    documentVersion: { type: String, trim: true },
    effectiveDate: { type: Date },
    generatedAt: { type: Date },
    reviewedAt: { type: Date, default: Date.now },
    dataSnapshot: { type: Mixed },
    contentSnapshot: { type: String },
    contentHash: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { _id: true }
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
