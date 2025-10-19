export function notFound(req, res, next) {
  res.status(404).json({
    message: "Resource not found",
    path: req.originalUrl,
  });
}

export function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  const payload = {
    message: err.message || "Internal server error",
  };

  if (process.env.NODE_ENV !== "production" && err.stack) {
    payload.stack = err.stack;
  }

  if (err.details) {
    payload.details = err.details;
  }

  // eslint-disable-next-line no-console
  console.error("Unhandled error", err);

  res.status(status).json(payload);
}
