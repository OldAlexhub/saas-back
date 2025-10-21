import mongoose from "mongoose";

const DriverMessageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    audienceType: {
      type: String,
      enum: ["all", "driver"],
      required: true,
    },
    driverIds: {
      type: [String],
      default: [],
      validate: {
        validator(value) {
          if (this.audienceType === "driver") {
            return Array.isArray(value) && value.length > 0;
          }
          return Array.isArray(value) ? value.length === 0 : true;
        },
        message: "Provide at least one driverId when targeting specific drivers.",
      },
    },
    sendAt: { type: Date, required: true },
  nextRunAt: { type: Date, required: true },
    lastRunAt: { type: Date },
    scheduleType: {
      type: String,
      enum: ["once", "repeat"],
      default: "once",
    },
    repeatFrequency: {
      type: String,
      enum: [null, "daily", "weekly"],
      default: null,
    },
    repeatUntil: { type: Date },
    status: {
      type: String,
      enum: ["scheduled", "sent", "cancelled"],
      default: "scheduled",
    },
    createdBy: { type: String },
    notes: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

DriverMessageSchema.index({ status: 1, nextRunAt: 1 });

// ensure single-field indexes that were previously inline
DriverMessageSchema.index({ nextRunAt: 1 });
DriverMessageSchema.index({ status: 1 });

const DriverMessageModel = mongoose.model("driver_messages", DriverMessageSchema);

export default DriverMessageModel;
