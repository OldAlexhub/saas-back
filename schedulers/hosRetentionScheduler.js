import CompanyModel from '../models/CompanySchema.js';
import DriverDutyModel from '../models/DriverDuty.js';
import DriverHOSModel from '../models/DriverHOS.js';

// Runs a daily job that purges DriverHOS and DriverDuty records older than each
// company's RECORD_RETENTION_MONTHS setting (fallback to server default if unset).

const DEFAULT_INTERVAL_MS = 24 * 3600 * 1000; // daily

export function startHosRetentionScheduler(intervalMs = DEFAULT_INTERVAL_MS) {
  // run once at startup, then schedule daily
  (async () => {
    try {
      await runRetentionPass();
      console.log('HOS retention: initial run complete');
    } catch (err) {
      console.warn('HOS retention initial run failed', err?.message || err);
    }
  })();

  setInterval(() => {
    runRetentionPass().catch((err) => {
      console.warn('HOS retention scheduled run failed', err?.message || err);
    });
  }, intervalMs);
}

async function runRetentionPass() {
  // load companies and compute a conservative global cutoff (use the MIN retention months across companies)
  const companies = await CompanyModel.find().select('hosSettings').lean();
  if (!Array.isArray(companies) || companies.length === 0) return;

  const monthsList = companies.map((c) => Number((c && c.hosSettings && c.hosSettings.RECORD_RETENTION_MONTHS) || 12)).filter((m) => Number.isFinite(m) && m > 0);
  const months = monthsList.length ? Math.min(...monthsList) : 12;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  // DriverDuty: remove by startAt < cutoff
  try {
    const dutyRes = await DriverDutyModel.deleteMany({ startAt: { $lt: cutoff } });
    if (dutyRes && typeof dutyRes.deletedCount === 'number') {
      console.log(`HOS retention: deleted ${dutyRes.deletedCount} old DriverDuty docs (cutoff ${cutoff.toISOString()})`);
    }
  } catch (err) {
    console.warn('HOS retention: failed deleting DriverDuty', err?.message || err);
  }

  // DriverHOS stores date as YYYY-MM-DD string (UTC). Compute cutoffDateStr
  const cutoffDate = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate()));
  const y = cutoffDate.getUTCFullYear();
  const m = String(cutoffDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(cutoffDate.getUTCDate()).padStart(2, '0');
  const cutoffDateStr = `${y}-${m}-${d}`;

  try {
    const hosRes = await DriverHOSModel.deleteMany({ date: { $lt: cutoffDateStr } });
    if (hosRes && typeof hosRes.deletedCount === 'number') {
      console.log(`HOS retention: deleted ${hosRes.deletedCount} old DriverHOS docs (cutoff ${cutoffDateStr})`);
    }
  } catch (err) {
    console.warn('HOS retention: failed deleting DriverHOS', err?.message || err);
  }
}
