import mongoose from "mongoose";

const AdminSchema = new mongoose.Schema(
  {
    company: { type: String, required: true },

    firstName: { type: String, required: true },

    lastName: { type: String, required: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
        message: (props) => `${props.value} is not a valid email address`,
      },
    },

    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false,
    },

    approved: {
      type: String,
      enum: ["yes", "no"],
      default: "no",
    },

    phoneNumber: {
      type: String,
      validate: {
        validator: (v) => /^\+?[0-9]{7,15}$/.test(v),
        message: (props) => `${props.value} is not a valid phone number`,
      },
    },
  },
  { timestamps: true }
);


const AdminModel = mongoose.model("Admin", AdminSchema);
export default AdminModel;
