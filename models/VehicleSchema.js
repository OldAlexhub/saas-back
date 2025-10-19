import mongoose from "mongoose";

const FileRecordSchema = new mongoose.Schema(
  {
    filename: { type: String },
    originalName: { type: String },
    mimeType: { type: String },
    size: { type: Number },
    url: { type: String },
  },
  { _id: false }
);

const VehicleSchema = mongoose.Schema({
  cabNumber: { type: String, required: true, unique: true },
  vinNumber: { type: String, required: true, unique: true },
  licPlates: { type: String, required: true, unique: true },
  regisExpiry: { type: Date, required: true },
  annualInspection: { type: Date },
  annualInspectionFile: FileRecordSchema,
  make: { type: String },
  model: { type: String },
  year: { type: Number, required: true },
  color: { type: String },
  ageVehicle: { type: Number },
  history: [
    {
      at: { type: Date, default: Date.now },
      by: { type: String }, // put user id/email/name here
      changes: {}, // { field: { from, to } }
    },
  ],
});

VehicleSchema.pre("save", function (next) {
  if (this.year) {
    const currentYear = new Date().getFullYear();
    this.ageVehicle = currentYear - this.year;
  }
  next();
});

const VehicleModel = mongoose.model("vehicles", VehicleSchema);
export default VehicleModel;
