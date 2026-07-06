const ApiError = require("../utils/apiError");
const logger = require("../config/logger");
const sanitizeUrl = require("../utils/sanitizeUrl");

function notFound(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${sanitizeUrl(req.originalUrl)}`));
}

function normalizeErrors(error) {
  if (!error.details) {
    return [];
  }

  if (Array.isArray(error.details)) {
    return error.details;
  }

  return [error.details];
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "Unique constraint failed",
      errors: [error.meta]
    });
  }

  if (error.code === "P2025") {
    return res.status(404).json({
      success: false,
      message: "Record not found",
      errors: []
    });
  }

  const statusCode = error.statusCode || 500;
  const payload = {
    success: false,
    message: error.message || "Internal server error",
    errors: normalizeErrors(error)
  };

  if (process.env.NODE_ENV !== "production" && statusCode === 500) {
    payload.errors.push({ stack: error.stack });
  }

  if (statusCode === 500) {
    logger.error({ err: error, path: sanitizeUrl(req.originalUrl) }, "Unhandled request error");
  } else {
    logger.warn({ err: error, path: sanitizeUrl(req.originalUrl), statusCode }, "Request failed");
  }

  return res.status(statusCode).json(payload);
}

module.exports = {
  notFound,
  errorHandler
};
