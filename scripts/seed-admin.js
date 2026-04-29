import dotenv from "dotenv";
import bcrypt from "bcrypt";
import connectTodb from "../db/connectTodb.js";
import AdminModel from "../models/AdminSchema.js";

dotenv.config();

const DEFAULTS = {
  email: process.env.SEED_ADMIN_EMAIL || "mohamed@mohamedgad.com",
  password: process.env.SEED_ADMIN_PASSWORD || "12345678",
  firstName: process.env.SEED_ADMIN_FIRSTNAME || "Mohamed",
  lastName: process.env.SEED_ADMIN_LASTNAME || "Gad",
  company: process.env.SEED_ADMIN_COMPANY || "TaxiOps",
  phoneNumber: process.env.SEED_ADMIN_PHONE || undefined,
};

const run = async () => {
  try {
    await connectTodb();

    const email = String(DEFAULTS.email).trim().toLowerCase();
    const password = String(DEFAULTS.password);

    if (!email || !password) {
      console.error("Email and password must be provided via env or defaults.");
      process.exit(1);
    }

    const existing = await AdminModel.findOne({ email }).select("+password");
    const hashed = await bcrypt.hash(password, 12);

    if (existing) {
      existing.password = hashed;
      existing.approved = "yes";
      existing.firstName = DEFAULTS.firstName;
      existing.lastName = DEFAULTS.lastName;
      existing.company = DEFAULTS.company;
      if (DEFAULTS.phoneNumber) existing.phoneNumber = DEFAULTS.phoneNumber;
      await existing.save();
      console.log(`Updated existing admin: ${email}`);
    } else {
      const doc = new AdminModel({
        email,
        password: hashed,
        firstName: DEFAULTS.firstName,
        lastName: DEFAULTS.lastName,
        company: DEFAULTS.company,
        approved: "yes",
        phoneNumber: DEFAULTS.phoneNumber,
      });
      await doc.save();
      console.log(`Created new admin: ${email}`);
    }

    console.log("Done. You can now log in as the admin (approved = yes).");
    process.exit(0);
  } catch (err) {
    console.error("Error seeding admin:", err);
    process.exit(2);
  }
};

run();
