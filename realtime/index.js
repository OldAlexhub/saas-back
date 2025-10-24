import jwt from "jsonwebtoken";
import { Server } from "socket.io";

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
  // Fire-and-forget: if the driver has a registered Expo push token, send
  // a remote push so the driver gets notified when the app is backgrounded.
  (async () => {
    try {
      const driver = await DriverModel.findOne({ driverId }).select('driverApp.pushToken firstName lastName').lean();
      const pushToken = driver?.driverApp?.pushToken;
      if (!pushToken) return;

      const title = payload?.pickupAddress ? `New dispatch: ${payload.pickupAddress}` : 'New dispatch';
      const body = payload?.dropoffAddress ? `Drop-off: ${payload.dropoffAddress}` : 'Tap to view assignment';

      // Expo token path (legacy Expo push service)
      if (typeof pushToken === 'string' && pushToken.startsWith('ExponentPushToken[')) {
        const message = {
          to: pushToken,
          sound: 'default',
          title,
          body,
          data: { event, payload },
        };
        if (process.env.PUSH_NOTIFICATION_IMAGE_URL) {
          message.image = process.env.PUSH_NOTIFICATION_IMAGE_URL;
        }

        try {
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
          });
          if (!res.ok) {
            const txt = await res.text();
            console.warn('Expo push API returned non-OK', res.status, txt);
          } else {
            const json = await res.json().catch(() => null);
            if (json && json.errors) {
              console.warn('Expo push API errors', json.errors);
            }
          }
        } catch (err) {
          console.warn('Error sending push to Expo API', err?.message || err);
        }
        return;
      }

      // FCM path: if a server key is configured, send via FCM legacy endpoint to
      // support native Firebase tokens (Android/iOS when using native Firebase).
      const fcmKey = process.env.FCM_SERVER_KEY || process.env.FIREBASE_SERVER_KEY;
      if (typeof pushToken === 'string' && fcmKey) {
        const fcmPayload = {
          to: pushToken,
          notification: {
            title,
            body,
            // optional: sound and click_action can be added by the client config
            sound: 'default',
          },
          data: { event, payload },
        };

        try {
          const res = await fetch('https://fcm.googleapis.com/fcm/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `key=${fcmKey}`,
            },
            body: JSON.stringify(fcmPayload),
          });
          if (!res.ok) {
            const txt = await res.text();
            console.warn('FCM send returned non-OK', res.status, txt);
          }
        } catch (err) {
          console.warn('Error sending push to FCM', err?.message || err);
        }
        return;
      }

      // If we reach here, we didn't recognize the token format or have no FCM
      // key configured. Log for diagnostics.
      console.warn('Unrecognized push token format or missing FCM key for driver', driverId);
    } catch (err) {
      try {
        // best-effort logging
        console.warn('Failed to send push notification for driver', driverId, err?.message || err);
      } catch (_e) {}
    }
  })();
}

export function emitToAllDrivers(event, payload) {
  if (!io) return;
  io.to("drivers").emit(event, payload);
}
