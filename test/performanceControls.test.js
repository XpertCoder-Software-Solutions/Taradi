const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-with-at-least-32-chars";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-whatsapp-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "test-phone-number-id";
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "test-business-account-id";
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "test-verify-token";
process.env.RATE_LIMIT_REDIS_ENABLED = "false";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

const env = require("../src/config/env");
const {
  buildWebhookJobId
} = require("../src/queues/webhook.queue");
const {
  isRetryableWebhookError,
  shouldRetryWebhookError,
  processQueuedWebhookEvent
} = require("../src/services/webhookProcessor.service");
const {
  createRateLimiter,
  closeRateLimiter
} = require("../src/middleware/rateLimit.middleware");

function createMockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function invokeMiddleware(middleware, req, res) {
  let settled = false;

  return new Promise((resolve, reject) => {
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      const result = originalJson(body);

      if (!settled) {
        settled = true;
        resolve({ nextCalled: false, res });
      }

      return result;
    };

    const next = (error) => {
      if (settled) {
        return;
      }

      settled = true;

      if (error) {
        reject(error);
        return;
      }

      resolve({ nextCalled: true, res });
    };

    Promise.resolve(middleware(req, res, next)).catch(reject);
  });
}

test.after(async () => {
  await closeRateLimiter();
});

test("builds stable webhook queue job ids", () => {
  assert.equal(buildWebhookJobId("audit-123"), "webhook-event-audit-123");
  assert.throws(() => buildWebhookJobId(null), /auditEventId/);
});

test("classifies transient webhook failures for BullMQ retries", () => {
  assert.equal(isRetryableWebhookError({ code: "P2024" }), true);
  assert.equal(isRetryableWebhookError({ code: "ETIMEDOUT" }), true);
  assert.equal(isRetryableWebhookError({ status: 429 }), true);
  assert.equal(isRetryableWebhookError({ message: "database is starting" }), true);
  assert.equal(isRetryableWebhookError({ status: 400, message: "invalid payload" }), false);

  assert.equal(shouldRetryWebhookError({ code: "ETIMEDOUT" }, { attempts: 3, attemptsMade: 1 }), true);
  assert.equal(shouldRetryWebhookError({ code: "ETIMEDOUT" }, { attempts: 3, attemptsMade: 2 }), false);
  assert.equal(shouldRetryWebhookError({ status: 400 }, { attempts: 3, attemptsMade: 0 }), false);
});

test("rejects malformed queued webhook jobs before touching persistence", async () => {
  await assert.rejects(
    processQueuedWebhookEvent(undefined),
    /auditEventId/
  );
});

test("rate limiter falls back to the local store when Redis is disabled", async () => {
  env.RATE_LIMIT_REDIS_ENABLED = false;
  env.RATE_LIMIT_REDIS_REQUIRED = false;

  const limiter = createRateLimiter({
    name: `test-${Date.now()}`,
    enabled: true,
    windowMs: 60 * 1000,
    limit: 2,
    keyGenerator: () => "fixed-key",
    message: "Too many requests"
  });
  const request = {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    originalUrl: "/limited"
  };

  const first = await invokeMiddleware(limiter, request, createMockResponse());
  const second = await invokeMiddleware(limiter, request, createMockResponse());
  const thirdResponse = createMockResponse();
  const third = await invokeMiddleware(limiter, request, thirdResponse);

  assert.equal(first.nextCalled, true);
  assert.equal(second.nextCalled, true);
  assert.equal(third.nextCalled, false);
  assert.equal(third.res.statusCode, 429);
  assert.equal(third.res.headers["X-RateLimit-Policy"].startsWith("test-"), true);
  assert.equal(third.res.headers["X-RateLimit-Limit"], "2");
  assert.equal(third.res.headers["X-RateLimit-Remaining"], "0");
  assert.equal(third.res.body.message, "Too many requests");
});

test("rate limiter module does not expose global API or auth limiters", () => {
  const rateLimiters = require("../src/middleware/rateLimit.middleware");

  assert.equal(rateLimiters.generalApiLimiter, undefined);
  assert.equal(rateLimiters.authLimiter, undefined);
});
