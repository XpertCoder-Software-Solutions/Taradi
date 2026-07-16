const pino = require("pino");
const env = require("./env");

const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.token",
      "req.body.WHATSAPP_TOKEN",
      "req.body.SYSTEM_USER_TOKEN",
      "req.body.META_ACCESS_TOKEN",
      "req.body.WHATSAPP_ACCESS_TOKEN",
      "headers.authorization",
      "headers.cookie",
      "config.headers.Authorization",
      "WHATSAPP_TOKEN",
      "SYSTEM_USER_TOKEN",
      "META_ACCESS_TOKEN",
      "WHATSAPP_ACCESS_TOKEN",
      "password",
      "passwordHash",
      "token"
    ],
    censor: "[REDACTED]"
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res
  }
});

const sensitiveKeyPattern = /(authorization|cookie|password|secret|token)/i;

function sanitizeDebugPayload(value, depth = 0) {
  if (depth > 6) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDebugPayload(item, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code
    };
  }

  const sanitized = {};

  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = sensitiveKeyPattern.test(key)
      ? "[REDACTED]"
      : sanitizeDebugPayload(item, depth + 1);
  }

  return sanitized;
}

logger.isDebugMode = env.DEBUG;

logger.debugStep = function debugStep(step, payload = {}) {
  if (!env.DEBUG) {
    return;
  }

  const message = step === "NEW WHATSAPP WEBHOOK"
    ? "========================\nNEW WHATSAPP WEBHOOK\n========================"
    : `[DEBUG] ${step}`;

  logger.info({
    debug: true,
    step,
    payload: sanitizeDebugPayload(payload)
  }, message);
};

module.exports = logger;
