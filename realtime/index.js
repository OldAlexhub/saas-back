import { Server } from "socket.io";
import jwt from "jsonwebtoken";

import config from "../config/index.js";
import AdminModel from "../models/AdminSchema.js";
import DriverModel from "../models/DriverSchema.js";

let io;

async function resolveAdminFromToken(token) {
  const payload = jwt.verify(token, config.jwt.secret);
  const admin = await AdminModel.findById(payload.userId).lean();
  if (!admin) {
    throw new Error("Admin not found");
  }
  return {
    id: admin._id.toString(),
    email: admin.email,
    company: admin.company,
  };
}

async function resolveDriverFromToken(token) {
  const payload = jwt.verify(token, config.driverJwt.secret);
  const driver = await DriverModel.findById(payload.driverId).lean();
  if (!driver) {
    throw new Error("Driver not found");
  }
  return {
    id: driver._id.toString(),
    driverId: driver.driverId,
    firstName: driver.firstName,
    lastName: driver.lastName,
  };
}

async function authorizeSocket(socket, next) {
  try {
    const auth = socket.handshake.auth || {};
    const query = socket.handshake.query || {};

    const role = auth.role || query.role;
    const token = auth.token || query.token;

    if (!role || !token) {
      throw new Error("Missing socket credentials");
    }

    if (role === "admin") {
      const admin = await resolveAdminFromToken(token);
      socket.data.role = "admin";
      socket.data.admin = admin;
      socket.join("admins");
    } else if (role === "driver") {
      const driver = await resolveDriverFromToken(token);
      socket.data.role = "driver";
      socket.data.driver = driver;
      socket.join("drivers");
      socket.join(`driver:${driver.driverId}`);
    } else {
      throw new Error("Unsupported socket role");
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function initRealtime(server) {
  if (io) {
    return io;
  }

  io = new Server(server, {
    cors: {
      origin: config.cors?.origin || "*",
      credentials: true,
    },
  });

  io.use(authorizeSocket);

  io.on("connection", (socket) => {
    if (socket.data.role === "admin") {
      socket.emit("realtime:ready", {
        role: "admin",
        admin: socket.data.admin,
      });
    } else if (socket.data.role === "driver") {
      socket.emit("realtime:ready", {
        role: "driver",
        driverId: socket.data.driver?.driverId,
      });
    }
  });

  return io;
}

export function getIO() {
  if (!io) {
    throw new Error("Realtime service has not been initialised.");
  }
  return io;
}

export function emitToAdmins(event, payload) {
  if (!io) return;
  io.to("admins").emit(event, payload);
}

export function emitToDriver(driverId, event, payload) {
  if (!io || !driverId) return;
  io.to(`driver:${driverId}`).emit(event, payload);
}

export function emitToAllDrivers(event, payload) {
  if (!io) return;
  io.to("drivers").emit(event, payload);
}
