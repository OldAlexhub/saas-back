import mongoose from "mongoose";

const NemtPaymentBatchSchema = new mongoose.Schema(
  {
    batchType: {
      type: String,
      enum: ["agency_billing", "driver_pay"],
      required: true,
    },

    // Agency billing (batchType === 'agency_billing')
    agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "nemtagencies" },
    agencyName: { type: String, trim: true },

    // Driver pay (batchType === 'driver_pay')
    driverId: { type: String, trim: true },
    driverName: { type: String, trim: true },

    trips: [{ type: mongoose.Schema.Types.ObjectId, ref: "nemttrips" }],
    tripCount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["draft", "sent", "paid", "disputed", "cancelled"],
      default: "draft",
    },

    billedAt: { type: Date },
    paidAt: { type: Date },
    referenceNumber: { type: String, trim: true },
    paymentMethod: {
      type: String,
      enum: ["check", "ach", "cash", "zelle", "venmo", "other"],
      default: null,
    },
    notes: { type: String, default: "" },

    history: [
      {
        at: { type: Date, default: Date.now },
        by: { type: String },
        action: { type: String },
        note: { type: String },
      },
    ],
  },
  { timestamps: true }
);

NemtPaymentBatchSchema.index({ batchType: 1, status: 1 });
NemtPaymentBatchSchema.index({ agencyId: 1, batchType: 1 });
NemtPaymentBatchSchema.index({ driverId: 1, batchType: 1 });
NemtPaymentBatchSchema.index({ createdAt: -1 });

const NemtPaymentBatchModel = mongoose.model("nemtpaymentbatches", NemtPaymentBatchSchema);
export default NemtPaymentBatchModel;
