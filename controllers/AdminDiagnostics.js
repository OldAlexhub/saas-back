import DriverDiagnosticsModel from '../models/DriverDiagnostics.js';

export const listDiagnostics = async (req, res) => {
  try {
    const { driverId, limit = 50, skip = 0 } = req.query || {};
    const q = {};
    if (driverId) q.driverId = String(driverId);

    const docs = await DriverDiagnosticsModel.find(q)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Math.min(200, Number(limit)))
      .lean();

    const count = await DriverDiagnosticsModel.countDocuments(q);
    return res.status(200).json({ count, diagnostics: docs });
  } catch (err) {
    console.error('listDiagnostics error', err);
    return res.status(500).json({ message: 'Failed to list diagnostics' });
  }
};
