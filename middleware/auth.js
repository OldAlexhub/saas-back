import jwt from "jsonwebtoken";
import AdminModel from "../models/AdminSchema.js";
import config from "../config/index.js";

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ message: "Authentication token missing." });
    }

    const payload = jwt.verify(token, config.jwt.secret);
    const admin = await AdminModel.findById(payload.userId).lean();
    if (!admin) {
      return res.status(401).json({ message: "Invalid authentication token." });
    }

    req.user = {
      id: admin._id.toString(),
      email: admin.email,
      company: admin.company,
      role: "admin",
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Authentication token expired." });
    }
    return res.status(401).json({ message: "Authentication failed." });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin privileges required." });
  }
  return next();
}
