import mongoose from "mongoose";
import DriverModel from "../models/DriverSchema.js";
import config from "../config/index.js";

const driverId = process.argv[2];
if (!driverId) {
  console.error('Usage: node debugDriver.mjs <driverId>');
  process.exit(1);
}

try {
  await mongoose.connect(config.mongo.uri);
  const driver = await DriverModel.findOne({ driverId })
    .select('+driverApp.passwordHash driverId firstName lastName driverApp.forcePasswordReset driverApp.lastLoginAt driverApp.lastLogoutAt')
    .lean();
  if (!driver) {
    console.log('Driver not found');
  } else {
    console.log(JSON.stringify(driver, null, 2));
  }
  await mongoose.disconnect();
} catch (err) {
  console.error('Error inspecting driver', err);
  process.exit(1);
}
