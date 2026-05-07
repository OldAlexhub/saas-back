#!/usr/bin/env node
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import path from "path";
import url from "url";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import AdminModel from "../models/AdminSchema.js";
import config from "../config/index.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

async function main() {
  try {
    const mongoUri = process.env.MONGO_URL || config.mongo.uri;
    if (!mongoUri) {
      console.error(
        "MONGO_URL is not set. Set it in your environment or .env file.",
      );
      process.exit(1);
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to MongoDB.");

    const email = "mohamed@mohamedgad.com".trim().toLowerCase();
    const password = "12345678";

    let existing = await AdminModel.findOne({ email });
    if (existing) {
      console.log(
        `Admin with email ${email} already exists:`,
        existing._id.toString(),
      );
      await mongoose.disconnect();
      process.exit(0);
    }

    const hashed = await bcrypt.hash(password, 12);

    const admin = new AdminModel({
      company: "TaxiOps",
      firstName: "Mohamed",
      lastName: "Gad",
      email,
      password: hashed,
      approved: "yes",
    });

    await admin.save();
    console.log("Admin created with id:", admin._id.toString());
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Error creating admin:", err);
    try {
      await mongoose.disconnect();
    } catch (e) {}
    process.exit(1);
  }
}

main();
