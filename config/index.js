import dotenv from "dotenv";
import path from "path";
import { mkdirSync } from "fs";

dotenv.config();

const requiredKeys = ["MONGO_URL", "SECRET_WORD", "MAPBOX_ACCESS_TOKEN"];
const missing = requiredKeys.filter((key) => !process.env[key] || process.env[key].trim() === "");
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      "Please define them in your environment or .env file before starting the server."
  );
}

const rootDir = process.cwd();
const uploadsDir = process.env.VEHICLE_UPLOAD_DIR
  ? path.resolve(process.env.VEHICLE_UPLOAD_DIR)
  : path.join(rootDir, "public", "uploads", "vehicles");

mkdirSync(uploadsDir, { recursive: true });

const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3001", 10),
  mongo: {
    uri: process.env.MONGO_URL,
  },
  mapbox: {
    token: process.env.MAPBOX_ACCESS_TOKEN,
  },
  jwt: {
    secret: process.env.SECRET_WORD,
    expiresIn: "3d",
  },
  driverJwt: {
    secret: process.env.DRIVER_APP_SECRET || process.env.SECRET_WORD,
    expiresIn: process.env.DRIVER_JWT_EXPIRES_IN || "7d",
  },
  uploads: {
    vehiclesDir: uploadsDir,
  },
};

export default config;
