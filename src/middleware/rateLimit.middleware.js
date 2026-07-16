const env = require("../config/env");
const logger = require("../config/logger");
const { createRedisConnection } = require("../config/redis");

const memoryStores = new Map();
let redisConnection = null;
let redisUnavailableUntil = 0;

const defaultMessage = "تمت محاولات كثيرة، برجاء الانتظار قليلًا ثم المحاولة مرة أخرى";

const passThroughLimiter = (req, res, next) => next();

function normalizeIp(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9:.:-]/g, "_")
    .slice(0, 96);
}

function defaultKeyGenerator(req) {
  return normalizeIp(req.ip || req.socket && req.socket.remoteAddress);
}

function userKeyGenerator(req) {
  return req.user && req.user.id ? `user:${req.user.id}` : defaultKeyGenerator(req);
}

function userCustomerKeyGenerator(req) {
  const userKey = userKeyGenerator(req);
  const customerId = req.params && (req.params.customerId || req.params.id);

  return customerId ? `${userKey}:customer:${customerId}` : userKey;
}

function getRedisLimiterConnection() {
  if (redisConnection && redisConnection.status === "end") {
    redisConnection = null;
  }

  if (!redisConnection) {
    redisConnection = createRedisConnection({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      commandTimeout: 500,
      retryStrategy: () => null
    });
  }

  return redisConnection;
}

async function incrementRedis(key, windowMs) {
  const client = getRedisLimiterConnection();

  if (client.status === "wait") {
    await client.connect();
  }

  const count = await client.incr(key);

  if (count === 1) {
    await client.pexpire(key, windowMs);
  }

  const ttl = await client.pttl(key);

  return {
    count,
    resetMs: ttl > 0 ? ttl : windowMs,
    store: "redis"
  };
}

function incrementMemory(key, windowMs) {
  const now = Date.now();
  const current = memoryStores.get(key);

  if (!current || current.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + windowMs
    };
    memoryStores.set(key, next);
    return {
      count: next.count,
      resetMs: windowMs,
      store: "memory"
    };
  }

  current.count += 1;
  return {
    count: current.count,
    resetMs: Math.max(current.resetAt - now, 1),
    store: "memory"
  };
}

async function incrementLimitCounter(key, windowMs) {
  const shouldTryRedis = env.RATE_LIMIT_REDIS_ENABLED && Date.now() >= redisUnavailableUntil;

  if (shouldTryRedis) {
    try {
      return await incrementRedis(key, windowMs);
    } catch (error) {
      redisUnavailableUntil = Date.now() + 5000;
      logger.warn({ err: error }, "Redis rate limiter unavailable");

      if (env.RATE_LIMIT_REDIS_REQUIRED) {
        throw error;
      }
    }
  }

  return incrementMemory(key, windowMs);
}

function sendRateLimitExceeded(res, policy, result, message = defaultMessage) {
  const retryAfterSeconds = Math.max(Math.ceil(result.resetMs / 1000), 1);

  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.setHeader("X-RateLimit-Limit", String(policy.limit));
  res.setHeader("X-RateLimit-Remaining", "0");
  res.setHeader("X-RateLimit-Reset", String(Math.ceil((Date.now() + result.resetMs) / 1000)));

  return res.status(429).json({
    success: false,
    message,
    errors: []
  });
}

function createRateLimiter(policy) {
  const enabled = policy.enabled !== false;

  if (!enabled) {
    return passThroughLimiter;
  }

  const keyGenerator = policy.keyGenerator || defaultKeyGenerator;
  const windowMs = policy.windowMs;
  const limit = policy.limit;
  const name = policy.name;

  return async function rateLimiter(req, res, next) {
    try {
      if (policy.skip && policy.skip(req)) {
        return next();
      }

      const rawKey = keyGenerator(req);
      const key = `${env.RATE_LIMIT_REDIS_PREFIX}:${name}:${rawKey}`;
      const result = await incrementLimitCounter(key, windowMs);
      const remaining = Math.max(limit - result.count, 0);

      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      res.setHeader("X-RateLimit-Policy", name);

      if (result.count > limit) {
        logger.warn({
          policy: name,
          key: rawKey,
          store: result.store,
          retryAfterMs: result.resetMs,
          path: req.originalUrl
        }, "Rate limit exceeded");

        return sendRateLimitExceeded(res, { limit }, result, policy.message);
      }

      return next();
    } catch (error) {
      logger.error({ err: error, policy: name, path: req.originalUrl }, "Rate limiter failed");

      return res.status(503).json({
        success: false,
        message: "خدمة الحماية من كثرة الطلبات غير متاحة مؤقتًا",
        errors: []
      });
    }
  };
}

const generalApiLimiter = createRateLimiter({
  name: "general",
  enabled: env.RATE_LIMIT_ENABLED,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  skip: (req) => (
    req.originalUrl.startsWith("/api/whatsapp/webhook") ||
    req.originalUrl.startsWith("/api/whatsapp/templates/bulk") ||
    (req.method === "GET" && req.originalUrl.startsWith("/api/customers"))
  )
});

const authLimiter = createRateLimiter({
  name: "auth",
  enabled: env.RATE_LIMIT_ENABLED && env.AUTH_RATE_LIMIT_ENABLED,
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: defaultKeyGenerator,
  message: "محاولات تسجيل الدخول كثيرة جدًا، برجاء الانتظار ثم المحاولة مرة أخرى"
});

const webhookLimiter = createRateLimiter({
  name: "webhook",
  enabled: env.RATE_LIMIT_ENABLED,
  windowMs: env.WEBHOOK_RATE_LIMIT_WINDOW_MS,
  limit: env.WEBHOOK_RATE_LIMIT_MAX,
  keyGenerator: defaultKeyGenerator
});

const messageSendLimiter = createRateLimiter({
  name: "message-send",
  enabled: env.RATE_LIMIT_ENABLED,
  windowMs: env.MESSAGE_RATE_LIMIT_WINDOW_MS,
  limit: env.MESSAGE_RATE_LIMIT_MAX,
  keyGenerator: userCustomerKeyGenerator,
  message: "تم إرسال رسائل كثيرة خلال وقت قصير، برجاء الانتظار قليلًا"
});

const mediaUploadLimiter = createRateLimiter({
  name: "media-upload",
  enabled: env.RATE_LIMIT_ENABLED,
  windowMs: env.UPLOAD_RATE_LIMIT_WINDOW_MS,
  limit: env.UPLOAD_RATE_LIMIT_MAX,
  keyGenerator: userCustomerKeyGenerator,
  message: "تم رفع ملفات كثيرة خلال وقت قصير، برجاء الانتظار قليلًا"
});

const importLimiter = createRateLimiter({
  name: "import",
  enabled: env.RATE_LIMIT_ENABLED,
  windowMs: env.IMPORT_RATE_LIMIT_WINDOW_MS,
  limit: env.IMPORT_RATE_LIMIT_MAX,
  keyGenerator: userKeyGenerator,
  message: "عمليات الاستيراد كثيرة جدًا، برجاء الانتظار قبل رفع ملف جديد"
});

const templateSyncLimiter = createRateLimiter({
  name: "template-sync",
  enabled: env.RATE_LIMIT_ENABLED,
  windowMs: env.TEMPLATE_SYNC_RATE_LIMIT_WINDOW_MS,
  limit: env.TEMPLATE_SYNC_RATE_LIMIT_MAX,
  keyGenerator: userKeyGenerator,
  message: "طلبات مزامنة القوالب كثيرة جدًا، برجاء الانتظار قليلًا"
});

async function closeRateLimiter() {
  if (redisConnection && redisConnection.status !== "end") {
    await redisConnection.quit();
  }

  redisConnection = null;
}

module.exports = {
  createRateLimiter,
  closeRateLimiter,
  generalApiLimiter,
  authLimiter,
  webhookLimiter,
  messageSendLimiter,
  mediaUploadLimiter,
  importLimiter,
  templateSyncLimiter
};
