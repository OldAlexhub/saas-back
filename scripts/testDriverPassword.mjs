import mongoose from "mongoose";
import DriverModel from "../models/DriverSchema.js";
import config from "../config/index.js";

const [driverId, password] = process.argv.slice(2);
if (!driverId || !password) {
  console.error('Usage: node testDriverPassword.mjs <driverId> <password>');
  process.exit(1);
}

try {
  await mongoose.connect(config.mongo.uri);
  const driver = await DriverModel.findOne({ driverId }).select('+driverApp.passwordHash');
  if (!driver) {
    console.error('Driver not found');
    process.exit(1);
  }
  const ok = await driver.verifyAppPassword(password);
  console.log(JSON.stringify({ driverId, ok }, null, 2));
  await mongoose.disconnect();
} catch (err) {
  console.error('Failed to verify password', err);
  process.exit(1);
}
