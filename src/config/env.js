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

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("*"),
  DEBUG: booleanFromEnv.default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  WEBHOOK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  WHATSAPP_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(16),
  WHATSAPP_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  META_APP_SECRET: z.string().optional().default(""),
  VERIFY_META_SIGNATURE: booleanFromEnv.default(false),
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

module.exports = {
  ...data,
  RATE_LIMIT_ENABLED: isProduction ? true : data.RATE_LIMIT_ENABLED,
  AUTH_RATE_LIMIT_ENABLED: isProduction ? true : data.AUTH_RATE_LIMIT_ENABLED,
  AUTH_RATE_LIMIT_WINDOW_MS: process.env.AUTH_RATE_LIMIT_WINDOW_MINUTES !== undefined
    ? data.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
    : data.AUTH_RATE_LIMIT_WINDOW_MS || data.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
};
