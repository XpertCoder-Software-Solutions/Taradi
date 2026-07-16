class ApiError extends Error {
  constructor(statusCode, message, details, options = {}) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.omitErrors = Boolean(options.omitErrors);
  }
}

module.exports = ApiError;
