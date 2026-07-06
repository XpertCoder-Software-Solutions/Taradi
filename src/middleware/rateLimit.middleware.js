const rateLimit = require("express-rate-limit");
const env = require("../config/env");

const passThroughLimiter = (req, res, next) => next();

const standardHandler = (req, res) => {
  res.status(429).json({
    success: false,
    message: "تمت محاولات كثيرة، برجاء الانتظار قليلًا ثم المحاولة مرة أخرى",
    errors: []
  });
};

function createLimiter(enabled, options) {
  return enabled ? rateLimit(options) : passThroughLimiter;
}

const generalApiLimiter = createLimiter(env.RATE_LIMIT_ENABLED, {
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.originalUrl.startsWith("/api/whatsapp/webhook"),
  handler: standardHandler
});

const authLimiter = createLimiter(env.RATE_LIMIT_ENABLED && env.AUTH_RATE_LIMIT_ENABLED, {
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: standardHandler
});

const webhookLimiter = createLimiter(env.RATE_LIMIT_ENABLED, {
  windowMs: env.WEBHOOK_RATE_LIMIT_WINDOW_MS,
  limit: env.WEBHOOK_RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: standardHandler
});

module.exports = {
  generalApiLimiter,
  authLimiter,
  webhookLimiter
};
