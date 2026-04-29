import DriverDiagnosticsModel from '../models/DriverDiagnostics.js';

// Admin endpoint: list diagnostics, optionally scoped to a driverId, with pagination.
// Query params:
//  - driverId (optional)
//  - limit (optional, default 100, max 1000)
//  - before (optional ISO timestamp) -> fetch entries before this time
//  - after (optional ISO timestamp) -> fetch entries after this time
export const listDiagnostics = async (req, res) => {
  try {
    const { driverId } = req.query || {};

    const limitRaw = Math.min(1000, Math.max(1, Number(req.query.limit || 100)));
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    const after = req.query.after ? new Date(String(req.query.after)) : null;

    const q = {};
    if (driverId && String(driverId).trim().length > 0) {
      q.driverId = String(driverId).trim();
    }
    if (before && !Number.isNaN(before.getTime())) {
      q.at = q.at || {};
      q.at.$lt = before;
    }
    if (after && !Number.isNaN(after.getTime())) {
      q.at = q.at || {};
      q.at.$gt = after;
    }

    const rows = await DriverDiagnosticsModel.find(q).sort({ at: -1 }).limit(limitRaw).lean();
    return res.status(200).json({ count: rows.length, diagnostics: rows });
  } catch (err) {
    console.error('listDiagnostics error', err);
    return res.status(500).json({ message: 'Failed to fetch diagnostics.' });
  }
};
