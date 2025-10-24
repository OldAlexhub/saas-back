import DriverMessageModel from '../models/DriverMessageSchema.js';
import { emitToAdmins, emitToAllDrivers, emitToDriver } from '../realtime/index.js';

// Run every 30 seconds by default
const DEFAULT_INTERVAL_MS = Number(process.env.DRIVER_MESSAGE_SCHEDULER_MS) || 30_000;

function computeNextRun({ sendAt, repeatFrequency, repeatUntil }) {
  const now = Date.now();
  let next = sendAt.getTime();

  if (!repeatFrequency || repeatFrequency === 'once') {
    return next < now ? new Date(now + 60 * 1000) : sendAt;
  }

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const ONE_WEEK_MS = 7 * ONE_DAY_MS;
  const increment = repeatFrequency === 'weekly' ? ONE_WEEK_MS : ONE_DAY_MS;

  while (next < now) {
    next += increment;
    if (repeatUntil && next > repeatUntil.getTime()) {
      return null;
    }
  }

  return new Date(next);
}

function buildAdminPayload(doc) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    body: doc.body,
    audienceType: doc.audienceType,
    driverIds: doc.driverIds,
    sendAt: doc.sendAt,
    nextRunAt: doc.nextRunAt,
    repeatFrequency: doc.repeatFrequency,
    repeatUntil: doc.repeatUntil,
    scheduleType: doc.scheduleType,
    status: doc.status,
    notes: doc.notes,
    lastRunAt: doc.lastRunAt,
  };
}

async function emitToAudience(messageDoc, payload) {
  if (messageDoc.audienceType === 'all') {
    emitToAllDrivers('message:new', payload);
  } else {
    (messageDoc.driverIds || []).forEach((driverId) => emitToDriver(driverId, 'message:new', payload));
  }
}

export function startDriverMessageScheduler() {
  let running = true;
  async function tick() {
    try {
      const now = new Date();
      const due = await DriverMessageModel.find({ status: 'scheduled', nextRunAt: { $lte: now } }).lean();
      if (!due || due.length === 0) return;

      for (const doc of due) {
        try {
          const payload = buildAdminPayload(doc);
          // Emit to drivers
          await emitToAudience(doc, payload);
          // Update lastRunAt and compute nextRunAt for repeats
          const nowDate = new Date();

          if (doc.scheduleType === 'once' || !doc.repeatFrequency) {
            await DriverMessageModel.updateOne({ _id: doc._id }, { $set: { status: 'sent', lastRunAt: nowDate } });
            emitToAdmins('message:sent', { message: payload });
          } else {
            const next = computeNextRun({ sendAt: doc.sendAt, repeatFrequency: doc.repeatFrequency, repeatUntil: doc.repeatUntil });
            if (!next) {
              await DriverMessageModel.updateOne({ _id: doc._id }, { $set: { status: 'sent', lastRunAt: nowDate } });
              emitToAdmins('message:sent', { message: payload });
            } else {
              await DriverMessageModel.updateOne({ _id: doc._id }, { $set: { nextRunAt: next, lastRunAt: nowDate } });
              emitToAdmins('message:scheduled', { message: { ...payload, nextRunAt: next } });
            }
          }
        } catch (e) {
          console.warn('Failed to deliver scheduled driver message', e?.message || e);
        }
      }
    } catch (err) {
      console.warn('Driver message scheduler tick error', err?.message || err);
    }
  }

  // Start the interval loop
  const id = setInterval(() => {
    if (!running) return clearInterval(id);
    tick();
  }, DEFAULT_INTERVAL_MS);

  // Run an immediate pass in case some messages are already due
  tick().catch(() => {});

  return () => {
    running = false;
    clearInterval(id);
  };
}

export default startDriverMessageScheduler;
