import mongoose from "mongoose";
import { fileRefSchema } from "./sharedSchemas.js";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const VehicleInspectionRecordSchema = new Schema(
  {
    onboardingId: { type: Schema.Types.ObjectId, ref: "DriverOnboarding", index: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle" },
    pucAuthorityOrPermitNumber: { type: String, trim: true },
    inspectionDateTime: { type: Date },
    carrierCompanyName: { type: String, trim: true },
    inspectionAgency: { type: String, trim: true },
    inspectorName: { type: String, trim: true },
    inspectorAseConfirmation: { type: Boolean, default: false },
    vehicleInfo: {
      vehicleNumber: { type: String, trim: true },
      year: { type: String, trim: true },
      make: { type: String, trim: true },
      model: { type: String, trim: true },
      vin: { type: String, trim: true },
      mileage: { type: Number },
      seatingCapacity: { type: Number },
    },
    inspectionItemResults: { type: Mixed, default: {} },
    wheelchairAccessible: { type: Boolean, default: false },
    wheelchairAccessibleRequirements: {
      liftOrRamp: { type: String, trim: true },
      tieDowns: { type: String, trim: true },
      restraints: { type: String, trim: true },
      webbingCutter: { type: String, trim: true },
      signage: { type: String, trim: true },
      slipResistantSurfaces: { type: String, trim: true },
      contrastingStepEdges: { type: String, trim: true },
      accessibleVehiclePassFail: { type: String, enum: ["", "pass", "fail"], default: "" },
    },
    passFail: { type: String, enum: ["", "pass", "fail"], default: "" },
    uploadedInspectionPdf: fileRefSchema,
  },
  { timestamps: true }
);

const VehicleInspectionRecord = mongoose.model("VehicleInspectionRecord", VehicleInspectionRecordSchema);
export default VehicleInspectionRecord;
