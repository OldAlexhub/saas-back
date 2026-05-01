import bcrypt from "bcrypt";
import dotenv from "dotenv";
import config from "../config/index.js";
import connectTodb from "../db/connectTodb.js";
import EnrollmeAdmin from "../models/enrollme/EnrollmeAdmin.js";
import { enrollmeSeedAdminSchema } from "../validators/enrollmeSchemas.js";

dotenv.config();

async function run() {
  try {
    if (!process.env.ENROLLME_ADMIN_EMAIL || !process.env.ENROLLME_ADMIN_PASSWORD) {
      console.error("ENROLLME_ADMIN_EMAIL and ENROLLME_ADMIN_PASSWORD are required.");
      process.exit(1);
    }

    if (!process.env.ENROLLME_JWT_SECRET && !process.env.JWT_SECRET && !process.env.SECRET_WORD) {
      console.error("ENROLLME_JWT_SECRET, JWT_SECRET, or SECRET_WORD is required for EnrollMe JWT auth.");
      process.exit(1);
    }

    const parsed = enrollmeSeedAdminSchema.parse({
      name: process.env.ENROLLME_ADMIN_NAME || "EnrollMe Super Admin",
      email: process.env.ENROLLME_ADMIN_EMAIL,
      password: process.env.ENROLLME_ADMIN_PASSWORD,
      role: process.env.ENROLLME_ADMIN_ROLE || "super_admin",
    });

    void config;
    await connectTodb();

    const passwordHash = await bcrypt.hash(parsed.password, 12);
    const existing = await EnrollmeAdmin.findOne({ email: parsed.email }).select("+passwordHash");

    if (existing) {
      existing.name = parsed.name;
      existing.passwordHash = passwordHash;
      existing.role = parsed.role;
      existing.isActive = true;
      await existing.save();
      console.log(`Updated EnrollMe admin: ${parsed.email}`);
    } else {
      await EnrollmeAdmin.create({
        name: parsed.name,
        email: parsed.email,
        passwordHash,
        role: parsed.role,
        isActive: true,
      });
      console.log(`Created EnrollMe admin: ${parsed.email}`);
    }

    process.exit(0);
  } catch (err) {
    console.error("Failed to seed EnrollMe admin:", err);
    process.exit(1);
  }
}

run();
