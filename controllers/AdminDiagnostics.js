// Admin diagnostics controller removed. Placeholder kept to avoid module resolution errors.
export const listDiagnostics = async (_req, res) => {
  return res.status(410).json({ message: 'Diagnostics feature removed' });
};
