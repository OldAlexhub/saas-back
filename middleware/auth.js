import jwt from "jsonwebtoken";
import config from "../config/index.js";
import AdminModel from "../models/AdminSchema.js";

export async function authenticate(req, res, next) {
  try {
    // Allow tests to disable authentication at runtime by setting DISABLE_AUTH
    // environment variable (some tests toggle this in beforeAll()). When set,
    // inject a fake admin user and continue.
    if (process.env.DISABLE_AUTH === 'true' || process.env.DISABLE_AUTH === '1') {
      req.user = { id: 'test-admin', email: 'test@example', company: null, role: 'admin' };
      return next();
    }
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
