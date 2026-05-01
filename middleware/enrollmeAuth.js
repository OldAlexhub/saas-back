import jwt from "jsonwebtoken";
import config from "../config/index.js";
import { ENROLLME_ADMIN_ROLES } from "../constants/enrollme.js";
import EnrollmeAdmin from "../models/enrollme/EnrollmeAdmin.js";

export const ENROLLME_ADMIN_COOKIE = "enrollmeAdminToken";

export function getEnrollmeAuthCookieOptions(overrides = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    ...overrides,
  };
}

function getBearerToken(req) {
  const header = req.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim();
}

export async function authenticateEnrollmeAdmin(req, res, next) {
  try {
    const token = req.cookies?.[ENROLLME_ADMIN_COOKIE] || getBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: "EnrollMe admin authentication token missing." });
    }

    const payload = jwt.verify(token, config.enrollme.jwt.secret);
    if (payload.scope !== "enrollme_admin" || !payload.adminId) {
      return res.status(401).json({ message: "Invalid EnrollMe admin token." });
    }

    const admin = await EnrollmeAdmin.findById(payload.adminId).lean();
    if (!admin || !admin.isActive) {
      return res.status(401).json({ message: "EnrollMe admin account is inactive or invalid." });
    }

    req.enrollmeAdmin = {
      id: admin._id.toString(),
      name: admin.name,
      email: admin.email,
      role: admin.role,
    };

    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "EnrollMe admin session expired." });
    }
    return res.status(401).json({ message: "EnrollMe admin authentication failed." });
  }
}

export function requireEnrollmeRole(...allowedRoles) {
  const roles = allowedRoles.length ? allowedRoles : ENROLLME_ADMIN_ROLES;
  return (req, res, next) => {
    if (!req.enrollmeAdmin || !roles.includes(req.enrollmeAdmin.role)) {
      return res.status(403).json({ message: "Insufficient EnrollMe admin privileges." });
    }
    return next();
  };
}
