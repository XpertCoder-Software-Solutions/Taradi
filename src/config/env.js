require("dotenv").config();

const { z } = require("zod");

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return false;
}, z.boolean());

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().min(1).default("7d"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("*"),
  DEBUG: booleanFromEnv.default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  RATE_LIMIT_REDIS_ENABLED: booleanFromEnv.default(true),
  RATE_LIMIT_REDIS_REQUIRED: booleanFromEnv.optional(),
  RATE_LIMIT_REDIS_PREFIX: z.string().min(1).default("taradi:rate-limit"),
  WEBHOOK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  MESSAGE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  MESSAGE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  IMPORT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  IMPORT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  TEMPLATE_SYNC_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  TEMPLATE_SYNC_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  WEBHOOK_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WEBHOOK_QUEUE_ATTEMPTS: z.coerce.number().int().positive().default(3),
  WEBHOOK_QUEUE_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
  WHATSAPP_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WHATSAPP_QUEUE_ATTEMPTS: z.coerce.number().int().positive().default(3),
  WHATSAPP_SEND_CONCURRENCY: z.coerce.number().int().positive().default(10),
  WHATSAPP_SEND_RATE_PER_SECOND: z.coerce.number().int().positive().default(50),
  CAMPAIGN_PREPARE_BATCH_SIZE: z.coerce.number().int().positive().default(250),
  CAMPAIGN_PREPARE_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  CAMPAIGN_PREPARE_QUEUE_ATTEMPTS: z.coerce.number().int().positive().default(3),
  CAMPAIGN_SEND_MAX: z.coerce.number().int().positive().default(20),
  CAMPAIGN_SEND_DURATION_MS: z.coerce.number().int().positive().default(60 * 1000),
  CAMPAIGN_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  CAMPAIGN_BATCH_DELAY_MS: z.coerce.number().int().nonnegative().default(5 * 60 * 1000),
  CAMPAIGN_MAX_ACTIVE_PER_PHONE: z.coerce.number().int().positive().default(1),
  CAMPAIGN_SEND_CONCURRENCY: z.coerce.number().int().positive().default(1),
  CAMPAIGN_SEND_ATTEMPTS: z.coerce.number().int().positive().default(5),
  CAMPAIGN_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(15 * 1000),
  CAMPAIGN_DISPATCH_LOCK_MS: z.coerce.number().int().positive().default(30 * 1000),
  CAMPAIGN_REQUIRE_OPT_IN: booleanFromEnv.default(true),
  CAMPAIGN_CUSTOMER_COOLDOWN_DAYS: z.coerce.number().int().nonnegative().default(7),
  CAMPAIGN_TEMPLATE_COOLDOWN_DAYS: z.coerce.number().int().nonnegative().default(14),
  CAMPAIGN_MAX_MESSAGES_PER_CUSTOMER_30_DAYS: z.coerce.number().int().positive().default(4),
  CAMPAIGN_AUTO_PAUSE_MIN_SAMPLE: z.coerce.number().int().positive().default(20),
  CAMPAIGN_AUTO_PAUSE_FAILURE_RATE_PERCENT: z.coerce.number().min(0).max(100).default(15),
  CAMPAIGN_AUTO_PAUSE_CONSECUTIVE_FAILURES: z.coerce.number().int().positive().default(10),
  CAMPAIGN_AUTO_PAUSE_AUTH_ERRORS: z.coerce.number().int().positive().default(1),
  CAMPAIGN_ADMIN_MAX_PER_MINUTE: z.coerce.number().int().positive().default(20),
  CAMPAIGN_ADMIN_MAX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  CAMPAIGN_ADMIN_MIN_BATCH_DELAY_MS: z.coerce.number().int().nonnegative().default(5 * 60 * 1000),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(16),
  WHATSAPP_TOKEN: optionalNonEmptyString,
  SYSTEM_USER_TOKEN: optionalNonEmptyString,
  WHATSAPP_ACCESS_TOKEN: optionalNonEmptyString,
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  META_APP_SECRET: z.string().optional().default(""),
  VERIFY_META_SIGNATURE: booleanFromEnv.default(false),
  META_GRAPH_API_VERSION: optionalNonEmptyString,
  META_API_VERSION: z.string().min(1).default("v20.0")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment configuration: ${details}`);
}

const data = parsed.data;
const isProduction = data.NODE_ENV === "production";
const corsOrigins = String(data.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function assertProductionSafety() {
  if (!isProduction) {
    return;
  }

  const errors = [];

  if (corsOrigins.length === 0 || corsOrigins.includes("*")) {
    errors.push("CORS_ORIGIN must be an explicit comma-separated allowlist in production");
  }

  if (!data.VERIFY_META_SIGNATURE) {
    errors.push("VERIFY_META_SIGNATURE must be true in production");
  }

  if (data.VERIFY_META_SIGNATURE && !data.META_APP_SECRET) {
    errors.push("META_APP_SECRET is required when VERIFY_META_SIGNATURE is enabled");
  }

  if (!data.RATE_LIMIT_REDIS_ENABLED) {
    errors.push("RATE_LIMIT_REDIS_ENABLED must be true in production");
  }

  if (data.RATE_LIMIT_REDIS_REQUIRED === false) {
    errors.push("RATE_LIMIT_REDIS_REQUIRED must not be false in production");
  }

  if (/change-me|local-dev|development/i.test(data.JWT_SECRET)) {
    errors.push("JWT_SECRET must not use a development placeholder in production");
  }

  if (errors.length > 0) {
    throw new Error(`Unsafe production environment configuration: ${errors.join("; ")}`);
  }
}

assertProductionSafety();

module.exports = {
  ...data,
  META_API_VERSION: data.META_GRAPH_API_VERSION || data.META_API_VERSION,
  META_GRAPH_API_VERSION: data.META_GRAPH_API_VERSION || data.META_API_VERSION,
  CORS_ORIGINS: corsOrigins,
  RATE_LIMIT_ENABLED: isProduction ? true : data.RATE_LIMIT_ENABLED,
  RATE_LIMIT_REDIS_REQUIRED: data.RATE_LIMIT_REDIS_REQUIRED === undefined
    ? isProduction
    : data.RATE_LIMIT_REDIS_REQUIRED
};
