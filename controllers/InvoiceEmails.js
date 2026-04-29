// Invoice email functionality removed. Stubs kept to avoid import errors if any
export const sendInvoiceEmail = async (req, res) => {
  return res.status(410).json({ message: 'Invoice email functionality removed.' });
};

export const sendInvoicesBatch = async (req, res) => {
  return res.status(410).json({ message: 'Invoice email functionality removed.' });
};
