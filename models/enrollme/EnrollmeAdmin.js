import mongoose from "mongoose";
import { ENROLLME_ADMIN_ROLES } from "../../constants/enrollme.js";

const EnrollmeAdminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value),
        message: "A valid email address is required.",
      },
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ENROLLME_ADMIN_ROLES,
      default: "reviewer",
    },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

const EnrollmeAdmin = mongoose.model("EnrollmeAdmin", EnrollmeAdminSchema);
export default EnrollmeAdmin;
