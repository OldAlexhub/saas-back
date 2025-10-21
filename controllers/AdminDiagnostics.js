import DriverDiagnosticsModel from '../models/DriverDiagnostics.js';

// Admin endpoint: list diagnostics for a given driverId with optional pagination.
// Query params:
//  - driverId (required)
//  - limit (optional, default 100, max 1000)
//  - before (optional ISO timestamp) -> fetch entries before this time
//  - after (optional ISO timestamp) -> fetch entries after this time
export const listDiagnostics = async (req, res) => {
  try {
    const { driverId } = req.query || {};
    if (!driverId || String(driverId).trim().length === 0) {
      return res.status(400).json({ message: 'driverId query parameter is required.' });
    }

    const limitRaw = Math.min(1000, Math.max(1, Number(req.query.limit || 100)));
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    const after = req.query.after ? new Date(String(req.query.after)) : null;

    const q = { driverId: String(driverId) };
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
