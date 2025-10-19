import mongoose from "mongoose";
import config from "../config/index.js";

let isConnected = false;

const connectTodb = async () => {
  if (isConnected) return mongoose.connection;

  try {
    await mongoose.connect(config.mongo.uri, {
      autoIndex: true,
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log("MongoDB connected successfully");
    return mongoose.connection;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error.message);
    throw error;
  }
};

const db = mongoose.connection;
db.on("error", (err) => {
  console.error("MongoDB connection error:", err.message);
});

db.on("disconnected", () => {
  console.warn("MongoDB disconnected");
});

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("MongoDB connection closed due to application termination");
  process.exit(0);
});

export default connectTodb;
