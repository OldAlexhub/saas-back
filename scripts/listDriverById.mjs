import mongoose from "mongoose";
import DriverModel from "../models/DriverSchema.js";
import config from "../config/index.js";

const driverId = process.argv[2];

(async () => {
  await mongoose.connect(config.mongo.uri);
  const docs = await DriverModel.find({ driverId }).select('driverId _id firstName lastName driverApp.forcePasswordReset');
  console.log('count', docs.length);
  for (const doc of docs) {
    console.log(doc._id.toString(), doc.driverApp?.forcePasswordReset);
  }
  await mongoose.disconnect();
})();
