import mongoose from "mongoose";

const FlatRateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    distanceLabel: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

FlatRateSchema.index({ active: 1, amount: 1 });
FlatRateSchema.index({ name: 1 }, { unique: false });

const FlatRateModel = mongoose.model("flat_rates", FlatRateSchema);
export default FlatRateModel;
