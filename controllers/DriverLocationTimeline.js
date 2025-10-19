import DriverLocationTimelineModel from "../models/DriverLocationTimeline.js";

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const listDriverLocationTimeline = async (req, res) => {
  try {
    const {
      driverId,
      bookingId,
      from,
      to,
      limit = 500,
      includeCoordinates = "true",
    } = req.query || {};

    const query = {};
    if (driverId) {
      query.driverId = String(driverId);
    }
    if (bookingId) {
      query.bookingId = bookingId;
    }

    const fromDate = toDateOrNull(from);
    const toDateValue = toDateOrNull(to);
    if (fromDate || toDateValue) {
      query.capturedAt = {};
      if (fromDate) query.capturedAt.$gte = fromDate;
      if (toDateValue) query.capturedAt.$lte = toDateValue;
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000);

    const projection = includeCoordinates === "false" ? { point: 0 } : undefined;

    const records = await DriverLocationTimelineModel.find(query, projection)
      .sort({ capturedAt: -1 })
      .limit(parsedLimit)
      .lean();

    return res.status(200).json({
      count: records.length,
      records,
    });
  } catch (error) {
    console.error("listDriverLocationTimeline error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load driver location timeline.", error: error.message });
  }
};

export default { listDriverLocationTimeline };
