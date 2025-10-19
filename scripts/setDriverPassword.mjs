import mongoose from "mongoose";
import DriverModel from "../models/DriverSchema.js";
import config from "../config/index.js";

const [driverId, newPassword] = process.argv.slice(2);
if (!driverId || !newPassword) {
  console.error('Usage: node setDriverPassword.mjs <driverId> <newPassword>');
  process.exit(1);
}

try {
  await mongoose.connect(config.mongo.uri);
  const driver = await DriverModel.findOne({ driverId }).select('+driverApp.passwordHash');
  if (!driver) {
    console.error('Driver not found');
    process.exit(1);
  }
  await driver.setAppPassword(newPassword, { forceReset: false });
  await driver.save();
  console.log('Password updated for driver', driverId);
  await mongoose.disconnect();
} catch (err) {
  console.error('Failed to update password', err);
  process.exit(1);
}
