import mongoose from "mongoose";

const SINGLETON_ID = "fares_singleton";

const FareSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: SINGLETON_ID,     
      immutable: true,
    },
    farePerMile: { type: Number, required: true, min: 0 },
    extraPass:   { type: Number, default: 0, min: 0 },
    waitTimePerMinute: { type: Number, required: true, min: 0 },
    baseFare: { type: Number, default: 0, min: 0 },
    minimumFare: { type: Number, default: 0, min: 0 },
    waitTriggerSpeedMph: { type: Number, default: 5, min: 0 },
    idleGracePeriodSeconds: { type: Number, default: 60, min: 0 },
    meterRoundingMode: {
      type: String,
      enum: ["none", "nearest_0.1", "nearest_0.25", "nearest_0.5", "nearest_1"],
      default: "nearest_0.1",
    },
    surgeEnabled: { type: Boolean, default: false },
    surgeMultiplier: { type: Number, default: 1, min: 0 },
    surgeNotes: { type: String, trim: true, maxlength: 240 },
    otherFees: {
      type: [
        {
          name: { type: String, required: true, trim: true, maxlength: 80 },
          amount: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, versionKey: false }
);

// Basic numeric guards
FareSchema.pre("validate", function (next) {
  const nums = [
    "farePerMile",
    "extraPass",
    "waitTimePerMinute",
    "baseFare",
    "minimumFare",
    "waitTriggerSpeedMph",
    "idleGracePeriodSeconds",
    "surgeMultiplier",
  ];
  for (const k of nums) {
    if (this[k] != null && Number.isNaN(Number(this[k]))) {
      return next(new Error(`${k} must be a number`));
    }
  }

  if (Array.isArray(this.otherFees)) {
    const normalised = [];
    for (const fee of this.otherFees) {
      if (!fee) continue;
      const name = typeof fee.name === "string" ? fee.name.trim() : "";
      const amount = Number(fee.amount);
      if (!name) continue;
      if (Number.isNaN(amount) || amount < 0) {
        return next(new Error("otherFees amount must be a non-negative number"));
      }
      normalised.push({ name, amount });
    }
    this.otherFees = normalised;
  }

  if (!this.surgeEnabled) {
    this.surgeMultiplier = this.surgeMultiplier && this.surgeMultiplier > 0 ? this.surgeMultiplier : 1;
  }
  next();
});

const FareModel = mongoose.model("fares", FareSchema);
export { FareModel, SINGLETON_ID };
