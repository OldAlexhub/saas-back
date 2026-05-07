import BookingModel from "../models/BookingSchema.js";
import DriverModel from "../models/DriverSchema.js";

function parseDateBound(value, endOfDay = false) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) {
    d.setUTCHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  }
  return d;
}

/**
 * GET /reports/financials
 * Query params: from, to (YYYY-MM-DD or ISO), driverId
 *
 * Returns:
 *  - summary: totalRevenue, totalTrips, avgFare, completedTrips, cancelledTrips, noShowTrips
 *  - byDriver: [{ driverId, driverName, trips, revenue, avgFare }]  (top 50 by revenue)
 *  - byDay:    [{ date, trips, revenue }]  (daily breakdown)
 */
export async function financialReport(req, res) {
  const { from, to, driverId } = req.query;

  const fromDate = parseDateBound(from, false) || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();
  const toDate = parseDateBound(to, true) || new Date();

  const match = {
    status: { $in: ["Completed", "Cancelled", "NoShow"] },
    pickupTime: { $gte: fromDate, $lte: toDate },
  };
  if (driverId) match.driverId = driverId;

  const [bookings, drivers] = await Promise.all([
    BookingModel.find(match)
      .select("driverId cabNumber status finalFare estimatedFare pickupTime pickupAddress dropoffAddress")
      .lean(),
    DriverModel.find({}).select("driverId firstName lastName").lean(),
  ]);

  const driverMap = {};
  for (const d of drivers) {
    driverMap[d.driverId] = `${d.firstName} ${d.lastName}`.trim();
  }

  const completed = bookings.filter((b) => b.status === "Completed");
  const totalRevenue = completed.reduce((s, b) => s + (b.finalFare ?? b.estimatedFare ?? 0), 0);

  // By-driver aggregation
  const driverAgg = {};
  for (const b of completed) {
    if (!b.driverId) continue;
    if (!driverAgg[b.driverId]) {
      driverAgg[b.driverId] = { driverId: b.driverId, driverName: driverMap[b.driverId] || b.driverId, trips: 0, revenue: 0 };
    }
    driverAgg[b.driverId].trips++;
    driverAgg[b.driverId].revenue += b.finalFare ?? b.estimatedFare ?? 0;
  }
  const byDriver = Object.values(driverAgg)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 50)
    .map((d) => ({ ...d, avgFare: d.trips ? d.revenue / d.trips : 0 }));

  // By-day aggregation (completed only)
  const dayAgg = {};
  for (const b of completed) {
    const day = b.pickupTime ? new Date(b.pickupTime).toISOString().slice(0, 10) : "unknown";
    if (!dayAgg[day]) dayAgg[day] = { date: day, trips: 0, revenue: 0 };
    dayAgg[day].trips++;
    dayAgg[day].revenue += b.finalFare ?? b.estimatedFare ?? 0;
  }
  const byDay = Object.values(dayAgg).sort((a, b) => a.date.localeCompare(b.date));

  return res.status(200).json({
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    summary: {
      totalRevenue,
      totalTrips: bookings.length,
      completedTrips: completed.length,
      cancelledTrips: bookings.filter((b) => b.status === "Cancelled").length,
      noShowTrips: bookings.filter((b) => b.status === "NoShow").length,
      avgFare: completed.length ? totalRevenue / completed.length : 0,
    },
    byDriver,
    byDay,
  });
}
