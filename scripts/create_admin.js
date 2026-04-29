import connectTodb from "../db/connectTodb.js";
import AdminModel from "../models/AdminSchema.js";
import bcrypt from "bcrypt";
import config from "../config/index.js";

async function run() {
  try {
    // ensure config loads env vars
    void config;
    await connectTodb();

    const email = "mohamed@mohamedgad.com".trim().toLowerCase();
    const existing = await AdminModel.findOne({ email }).select("+password");
    if (existing) {
      console.log(`Admin already exists: ${email}`);
      process.exit(0);
    }

    const password = "123456123";
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
    console.log(`Admin created: ${email}`);
    process.exit(0);
  } catch (err) {
    console.error("Failed to create admin:", err);
    process.exit(1);
  }
}

run();
