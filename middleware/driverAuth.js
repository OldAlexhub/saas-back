import jwt from "jsonwebtoken";
import DriverModel from "../models/DriverSchema.js";
import config from "../config/index.js";

export async function authenticateDriver(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ message: "Driver authentication token missing." });
    }

    const payload = jwt.verify(token, config.driverJwt.secret);
    const driver = await DriverModel.findById(payload.driverId).select("-ssn -history");
    if (!driver) {
      return res.status(401).json({ message: "Invalid driver token." });
    }

    req.driver = {
      id: driver._id.toString(),
      driverId: driver.driverId,
      firstName: driver.firstName,
      lastName: driver.lastName,
      email: driver.email,
      phoneNumber: driver.phoneNumber,
    };
    req.driverDoc = driver;

    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Driver token expired." });
    }
    console.error("Driver authentication error:", error);
    return res.status(401).json({ message: "Driver authentication failed." });
  }
}
