import mongoose from "mongoose";
import { fileRefSchema } from "./sharedSchemas.js";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const PreventiveMaintenancePlanSchema = new Schema(
  {
    onboardingId: { type: Schema.Types.ObjectId, ref: "DriverOnboarding", index: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle" },
    vehicleInfo: {
      vehicleNumber: { type: String, trim: true },
      make: { type: String, trim: true },
      year: { type: String, trim: true },
      vin: { type: String, trim: true },
      tireSize: { type: String, trim: true },
    },
    serviceScheduleRows: { type: [Mixed], default: [] },
    receipts: { type: [fileRefSchema], default: [] },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

const PreventiveMaintenancePlan = mongoose.model("PreventiveMaintenancePlan", PreventiveMaintenancePlanSchema);
export default PreventiveMaintenancePlan;
