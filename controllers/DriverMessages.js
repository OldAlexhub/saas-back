import DriverMessageModel from "../models/DriverMessageSchema.js";
import { emitToAdmins, emitToAllDrivers, emitToDriver } from "../realtime/index.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeNextRun({ sendAt, repeatFrequency, repeatUntil }) {
  const now = Date.now();
  let next = sendAt.getTime();

  if (!repeatFrequency || repeatFrequency === "once") {
    return next < now ? new Date(now + 60 * 1000) : sendAt;
  }

  const increment = repeatFrequency === "weekly" ? ONE_WEEK_MS : ONE_DAY_MS;

  while (next < now) {
    next += increment;
    if (repeatUntil && next > repeatUntil.getTime()) {
      return null;
    }
  }

  return new Date(next);
}

function validateAudience(audienceType, driverIds) {
  if (!["all", "driver"].includes(audienceType)) {
    throw new Error("audienceType must be 'all' or 'driver'.");
  }

  if (audienceType === "driver" && (!Array.isArray(driverIds) || driverIds.length === 0)) {
    throw new Error("Select at least one driver for targeted messages.");
  }

  return audienceType === "driver" ? driverIds.map(String) : [];
}

function resolveScheduleDetails({ sendAt, repeatMode = "none", repeatUntil }) {
  const initialSendAt = normalizeDate(sendAt);
  if (!initialSendAt) {
    throw new Error("sendAt must be a valid ISO timestamp.");
  }

  const repeatFrequency =
    repeatMode === "daily" ? "daily" : repeatMode === "weekly" ? "weekly" : null;
  const repeatUntilDate = normalizeDate(repeatUntil);

  if (repeatFrequency && repeatUntilDate && repeatUntilDate <= initialSendAt) {
    throw new Error("repeatUntil must be after the first scheduled send.");
  }

  const nextRunAt = computeNextRun({
    sendAt: initialSendAt,
    repeatFrequency,
    repeatUntil: repeatUntilDate,
  });

  if (!nextRunAt) {
    throw new Error(
      "The provided schedule has already expired. Adjust the start time or repeat window.",
    );
  }

  return {
    initialSendAt,
    repeatFrequency,
    repeatUntilDate,
    nextRunAt,
    scheduleType: repeatFrequency ? "repeat" : "once",
  };
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

function emitToAudience(message, payload, event) {
  if (message.audienceType === "all") {
    emitToAllDrivers(event, payload);
  } else {
    message.driverIds.forEach((driverId) => emitToDriver(driverId, event, payload));
  }
}

export const listDriverMessages = async (_req, res) => {
  try {
    const messages = await DriverMessageModel.find()
      .sort({ status: 1, nextRunAt: 1, createdAt: -1 })
      .lean();
    return res.status(200).json({ messages });
  } catch (error) {
    console.error("listDriverMessages error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load driver messages.", error: error.message });
  }
};

export const createDriverMessage = async (req, res) => {
  try {
    const {
      title,
      body,
      audienceType,
      driverIds = [],
      sendAt,
      repeatMode = "none",
      repeatUntil,
      notes,
    } = req.body || {};

    if (!title || !body) {
      return res.status(400).json({ message: "Title and body are required." });
    }

    let scheduleDetails;
    let resolvedDriverIds;

    try {
      resolvedDriverIds = validateAudience(audienceType, driverIds);
      scheduleDetails = resolveScheduleDetails({ sendAt, repeatMode, repeatUntil });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const doc = await DriverMessageModel.create({
      title: title.trim(),
      body: body.trim(),
      audienceType,
      driverIds: resolvedDriverIds,
      sendAt: scheduleDetails.initialSendAt,
      nextRunAt: scheduleDetails.nextRunAt,
      scheduleType: scheduleDetails.scheduleType,
      repeatFrequency: scheduleDetails.repeatFrequency,
      repeatUntil: scheduleDetails.repeatUntilDate || undefined,
      status: "scheduled",
      createdBy: req.user?.id ?? null,
      notes: notes?.trim() || undefined,
    });

  const payload = buildAdminPayload(doc);

  // Do NOT emit the scheduled message to drivers immediately. It should only
  // be emitted when the scheduler reaches `nextRunAt`. Notify admins that
  // the message is scheduled instead.
  emitToAdmins("message:scheduled", { message: payload });

  return res.status(201).json({ message: "Message scheduled.", driverMessage: doc });
  } catch (error) {
    console.error("createDriverMessage error:", error);
    return res
      .status(500)
      .json({ message: "Failed to schedule driver message.", error: error.message });
  }
};

export const updateDriverMessage = async (req, res) => {
  try {
    const {
      title,
      body,
      audienceType,
      driverIds = [],
      sendAt,
      repeatMode = "none",
      repeatUntil,
      notes,
    } = req.body || {};
    const { id } = req.params;

    if (!title || !body) {
      return res.status(400).json({ message: "Title and body are required." });
    }

    const message = await DriverMessageModel.findById(id);
    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }
    if (message.status !== "scheduled") {
      return res
        .status(400)
        .json({ message: "Only scheduled messages can be edited." });
    }

    let scheduleDetails;
    let resolvedDriverIds;
    try {
      resolvedDriverIds = validateAudience(audienceType, driverIds);
      scheduleDetails = resolveScheduleDetails({ sendAt, repeatMode, repeatUntil });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    message.title = title.trim();
    message.body = body.trim();
    message.audienceType = audienceType;
    message.driverIds = resolvedDriverIds;
    message.sendAt = scheduleDetails.initialSendAt;
    message.nextRunAt = scheduleDetails.nextRunAt;
    message.repeatFrequency = scheduleDetails.repeatFrequency;
    message.repeatUntil = scheduleDetails.repeatUntilDate || undefined;
    message.scheduleType = scheduleDetails.scheduleType;
    message.notes = notes?.trim() || undefined;

    await message.save();

    const payload = buildAdminPayload(message);
    emitToAdmins("message:updated", { message: payload });

    return res.status(200).json({ message: "Message updated.", driverMessage: message });
  } catch (error) {
    console.error("updateDriverMessage error:", error);
    return res
      .status(500)
      .json({ message: "Failed to update driver message.", error: error.message });
  }
};

export const sendDriverMessageNow = async (req, res) => {
  try {
    const { title, body, audienceType, driverIds = [], notes } = req.body || {};

    if (!title || !body) {
      return res.status(400).json({ message: "Title and body are required." });
    }

    let resolvedDriverIds;
    try {
      resolvedDriverIds = validateAudience(audienceType, driverIds);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const now = new Date();

    const doc = await DriverMessageModel.create({
      title: title.trim(),
      body: body.trim(),
      audienceType,
      driverIds: resolvedDriverIds,
      sendAt: now,
      nextRunAt: now,
      lastRunAt: now,
      scheduleType: "once",
      repeatFrequency: null,
      status: "sent",
      createdBy: req.user?.id ?? null,
      notes: notes?.trim() || undefined,
    });

    const payload = buildAdminPayload(doc);

    emitToAudience(doc, payload, "message:new");
    emitToAdmins("message:sent", { message: payload });

    return res.status(201).json({ message: "Message sent.", driverMessage: doc });
  } catch (error) {
    console.error("sendDriverMessageNow error:", error);
    return res
      .status(500)
      .json({ message: "Failed to send driver message.", error: error.message });
  }
};

export const deleteDriverMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await DriverMessageModel.findById(id);
    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    const payload = {
      id: message._id.toString(),
      status: "cancelled",
      driverIds: message.driverIds,
      audienceType: message.audienceType,
    };

    if (message.status === "scheduled") {
      emitToAudience(message, payload, "message:cancelled");
      emitToAdmins("message:cancelled", { message: payload });
    }

    await DriverMessageModel.deleteOne({ _id: id });
    emitToAdmins("message:deleted", { id: payload.id });

    return res.status(200).json({ message: "Message deleted." });
  } catch (error) {
    console.error("deleteDriverMessage error:", error);
    return res
      .status(500)
      .json({ message: "Failed to delete driver message.", error: error.message });
  }
};

// --- Driver-app actions ---
export const driverAcknowledgeMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const driver = req.driver || { id: null };
    // Optionally validate message exists
    const message = await DriverMessageModel.findById(id).lean();
    if (!message) return res.status(404).json({ message: 'Driver message not found.' });

    // Notify admins that a driver acknowledged (for auditing/visibility)
    emitToAdmins('message:acknowledged', { messageId: id, driver, at: new Date() });
    return res.status(200).json({ message: 'Acknowledged' });
  } catch (err) {
    console.error('driverAcknowledgeMessage error', err);
    return res.status(500).json({ message: 'Failed to acknowledge message.' });
  }
};

export const driverSnoozeMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { minutes = 10 } = req.body || {};
    const driver = req.driver || { id: null };
    const message = await DriverMessageModel.findById(id).lean();
    if (!message) return res.status(404).json({ message: 'Driver message not found.' });

    const snoozeUntil = new Date(Date.now() + Math.max(1, Number(minutes) || 10) * 60 * 1000);
    // Notify admins for visibility; clients snooze locally — server doesn't reschedule
    emitToAdmins('message:snoozed', { messageId: id, driver, snoozeUntil });
    return res.status(200).json({ message: 'Snoozed', snoozeUntil });
  } catch (err) {
    console.error('driverSnoozeMessage error', err);
    return res.status(500).json({ message: 'Failed to snooze message.' });
  }
};
