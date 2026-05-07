import mongoose from "mongoose";

const NemtImportRowSchema = new mongoose.Schema(
  {
    rowNumber: { type: Number, required: true },
    status: {
      type: String,
      enum: ["valid", "warning", "error", "imported", "skipped"],
      default: "valid",
    },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    errors: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
    createdTripId: { type: mongoose.Schema.Types.ObjectId, ref: "nemttrips" },
    createdTripNumber: { type: Number },
    correctedAt: { type: Date },
    correctionNote: { type: String },
  },
  { _id: false, suppressReservedKeysWarning: true }
);

const NemtImportBatchSchema = new mongoose.Schema(
  {
    batchId: { type: String, unique: true, trim: true },
    agencyId: { type: String, required: true, trim: true },
    serviceDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["staged", "committed", "partially_committed", "cancelled"],
      default: "staged",
    },
    sourceFileName: { type: String, trim: true },
    sourceMimeType: { type: String, trim: true },
    totalRows: { type: Number, default: 0 },
    validRows: { type: Number, default: 0 },
    warningRows: { type: Number, default: 0 },
    errorRows: { type: Number, default: 0 },
    importedRows: { type: Number, default: 0 },
    skippedRows: { type: Number, default: 0 },
    rows: { type: [NemtImportRowSchema], default: [] },
    committedAt: { type: Date },
    committedBy: { type: String },
    cancelledAt: { type: Date },
    cancelledBy: { type: String },
    rolledBackAt: { type: Date },
    rolledBackBy: { type: String },
  },
  { timestamps: true }
);

NemtImportBatchSchema.pre("save", function (next) {
  if (!this.batchId) {
    this.batchId = `NEMT-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  this.totalRows = this.rows.length;
  this.validRows = this.rows.filter((r) => r.status === "valid").length;
  this.warningRows = this.rows.filter((r) => r.status === "warning").length;
  this.errorRows = this.rows.filter((r) => r.status === "error").length;
  this.importedRows = this.rows.filter((r) => r.status === "imported").length;
  this.skippedRows = this.rows.filter((r) => r.status === "skipped").length;
  next();
});

NemtImportBatchSchema.index({ agencyId: 1, serviceDate: 1, createdAt: -1 });
NemtImportBatchSchema.index({ status: 1, createdAt: -1 });

const NemtImportBatchModel = mongoose.model("nemtimportbatches", NemtImportBatchSchema);
export default NemtImportBatchModel;
