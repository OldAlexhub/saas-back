import mongoose from "mongoose";

const NemtAgencySchema = new mongoose.Schema(
  {
    agencyId: { type: String, unique: true },
    name: { type: String, required: true, trim: true },
    contactName: { type: String, trim: true, default: "" },
    contactEmail: { type: String, trim: true, lowercase: true, default: "" },
    contactPhone: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    billingEmail: { type: String, trim: true, lowercase: true, default: "" },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    history: [
      {
        at: { type: Date, default: Date.now },
        by: { type: String },
        changes: { type: mongoose.Schema.Types.Mixed },
      },
    ],
  },
  { timestamps: true }
);

NemtAgencySchema.pre("save", function (next) {
  if (!this.agencyId) {
    this.agencyId = Math.floor(10000 + Math.random() * 90000).toString();
  }
  next();
});

NemtAgencySchema.index({ status: 1 });
NemtAgencySchema.index({ name: 1 });

const NemtAgencyModel = mongoose.model("nemtagencies", NemtAgencySchema);
export default NemtAgencyModel;
