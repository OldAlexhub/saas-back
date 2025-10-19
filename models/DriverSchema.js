import bcrypt from "bcrypt";
import mongoose from "mongoose";

// Define sub-schema for history entries
const HistorySchema = new mongoose.Schema(
  {
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String }, // optional: store admin/user email or ID
    oldData: { type: Object, required: true },
  },
  { _id: false }
);

const DriverAppAuthSchema = new mongoose.Schema(
  {
    passwordHash: { type: String, select: false },
    forcePasswordReset: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    lastLogoutAt: { type: Date },
    deviceId: { type: String },
    pushToken: { type: String },
  },
  { _id: false }
);

const DriverSchema = new mongoose.Schema(
  {
    driverId: { type: String, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    dlNumber: { type: String, required: true },
    email: { type: String, unique: true, required: true, lowercase: true, trim: true },
    dob: { type: Date, required: true },
    dlExpiry: { type: Date, required: true },
    dotExpiry: { type: Date, required: true },
    fullAddress: { type: String, required: true },
    ssn: { type: String, required: true, select: false },
    ssnLast4: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    cbiExpiry: { type: Date, required: true },
    mvrExpiry: { type: Date, required: true },
    fingerPrintsExpiry: { type: Date, required: true },

    // New: historical record tracking
    history: [HistorySchema],

    // Driver mobile app auth metadata
    driverApp: {
      type: DriverAppAuthSchema,
      default: () => ({ forcePasswordReset: true }),
    },
  },
  { timestamps: true }
);

// Generate unique 5-digit driverId
DriverSchema.pre("save", async function (next) {
  if (!this.driverId) {
    let isUnique = false;
    let newId;
    while (!isUnique) {
      newId = Math.floor(10000 + Math.random() * 90000).toString();
      const existing = await mongoose.models.Driver.findOne({ driverId: newId });
      if (!existing) isUnique = true;
    }
    this.driverId = newId;
  }
  next();
});

DriverSchema.methods.setAppPassword = async function (password, { forceReset = false } = {}) {
  if (!password || typeof password !== "string" || password.trim().length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }

  const hashed = await bcrypt.hash(password.trim(), 12);
  if (!this.driverApp) this.driverApp = {};
  this.driverApp.passwordHash = hashed;
  this.driverApp.forcePasswordReset = Boolean(forceReset);
};

DriverSchema.methods.verifyAppPassword = async function (candidatePassword) {
  const hash = this.driverApp?.passwordHash;
  if (!hash || candidatePassword === undefined || candidatePassword === null) return false;
  return bcrypt.compare(String(candidatePassword), hash);
};

// Pre-update middleware to push old record to history
DriverSchema.pre("findOneAndUpdate", async function (next) {
  try {
    const docToUpdate = await this.model.findOne(this.getQuery()).lean();
    if (docToUpdate) {
      const updateBy = this.getOptions().updatedBy || "system"; // optional context
      await this.model.updateOne(
        this.getQuery(),
        {
          $push: {
            history: {
              updatedAt: new Date(),
              updatedBy: updateBy,
              oldData: docToUpdate,
            },
          },
        }
      );
    }
    next();
  } catch (err) {
    console.error("Error saving driver history:", err);
    next(err);
  }
});

const DriverModel = mongoose.model("Driver", DriverSchema);

export default DriverModel;
