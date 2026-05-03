import mongoose from "mongoose";

const { Schema } = mongoose;

const internalNoteSchema = new Schema(
  {
    note: { type: String, required: true, trim: true },
    addedBy: { type: String, trim: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const AccidentReportSchema = new Schema(
  {
    reportNumber: { type: String, unique: true, index: true },

    // When and where
    incidentDate: { type: Date, required: true, index: true },
    incidentTime: { type: String, trim: true },
    location: { type: String, required: true, trim: true },

    // Incident type
    type: {
      type: String,
      enum: ["accident", "incident", "citation", "complaint", "regulatory_inquiry", "safety_event"],
      required: true,
      index: true,
    },

    // What happened
    description: { type: String, required: true, trim: true },

    // Driver (ref + snapshot so the report survives driver record changes)
    driverRef: { type: Schema.Types.ObjectId, ref: "Driver" },
    driverName: { type: String, required: true, trim: true },
    driverIdNumber: { type: String, trim: true },

    // Vehicle (ref + snapshot)
    vehicleRef: { type: Schema.Types.ObjectId, ref: "vehicles" },
    vehiclePlate: { type: String, trim: true },
    vehicleDescription: { type: String, trim: true },

    // Passengers
    passengersInvolved: { type: Boolean, default: false },
    passengerInjuries: { type: String, trim: true },

    // Third party
    thirdPartyInvolved: { type: Boolean, default: false },
    thirdPartyInfo: { type: String, trim: true },

    // Police
    policeInvolved: { type: Boolean, default: false },
    policeReportNumber: { type: String, trim: true },

    // Injuries
    injuries: { type: Boolean, default: false },
    injuryDescription: { type: String, trim: true },

    // Property damage
    propertyDamage: { type: Boolean, default: false },
    damageDescription: { type: String, trim: true },

    // Insurance
    insuranceClaimed: { type: Boolean, default: false },
    insuranceClaimNumber: { type: String, trim: true },

    // Status / resolution
    status: {
      type: String,
      enum: ["open", "under_review", "resolved", "closed"],
      default: "open",
      index: true,
    },
    resolution: { type: String, trim: true },
    resolvedAt: { type: Date },

    // Internal notes
    internalNotes: { type: [internalNoteSchema], default: [] },

    // Who filed
    reportedBy: { type: String, trim: true },
  },
  { timestamps: true }
);

AccidentReportSchema.index({ driverRef: 1 });
AccidentReportSchema.index({ createdAt: -1 });

const AccidentReport = mongoose.model("AccidentReport", AccidentReportSchema);
export default AccidentReport;
