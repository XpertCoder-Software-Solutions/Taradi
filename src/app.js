const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const swaggerUi = require("swagger-ui-express");
const routes = require("./routes");
const env = require("./config/env");
const logger = require("./config/logger");
const prisma = require("./config/prisma");
const { createRedisConnection } = require("./config/redis");
const { CAMPAIGN_PREPARE_QUEUE, WHATSAPP_OUTBOUND_QUEUE, WHATSAPP_WEBHOOK_QUEUE } = require("./queues/whatsapp.constants");
const { getSwaggerSpecForRequest } = require("./config/swagger");
const sanitizeUrl = require("./utils/sanitizeUrl");
const { ensureUploadDirectory } = require("./utils/mediaStorage");
const { notFound, errorHandler } = require("./middleware/error.middleware");
const responseMiddleware = require("./middleware/response.middleware");
const {
  webhookLimiter
} = require("./middleware/rateLimit.middleware");

const app = express();
const corsOrigin = env.CORS_ORIGIN === "*"
  ? true
  : env.CORS_ORIGINS.length === 1 ? env.CORS_ORIGINS[0] : env.CORS_ORIGINS;

app.set("trust proxy", 1);

app.use(pinoHttp({
  logger,
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: sanitizeUrl(req.url),
        remoteAddress: req.remoteAddress,
        remotePort: req.remotePort
      };
    }
  }
}));
app.get("/api/docs.json", (req, res) => {
  res.json(getSwaggerSpecForRequest(req));
});
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(null, {
  explorer: true,
  customSiteTitle: "Taradi API Docs",
  swaggerOptions: {
    url: "/api/docs.json"
  }
}));

app.use(helmet());
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
app.use(express.json({
  limit: "2mb",
  verify(req, res, buffer) {
    if (req.method === "POST" && req.originalUrl.startsWith("/api/whatsapp/webhook")) {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));
ensureUploadDirectory();
app.use("/uploads", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Media files are served through authenticated API endpoints",
    errors: []
  });
});
app.use(responseMiddleware);
app.use("/api/whatsapp/webhook", webhookLimiter);

app.get("/health", (req, res) => {
  res.success({
    status: "ok",
    service: "taradi-whatsapp-crm-backend"
  });
});

app.get("/ready", async (req, res) => {
  const checks = {
    postgres: "unknown",
    redis: "unknown",
    queue: "unknown",
    webhookQueue: "unknown",
    campaignQueue: "unknown",
    config: "ok"
  };
  let redis;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = "ok";
  } catch (error) {
    checks.postgres = "error";
    logger.warn({ err: error }, "Readiness PostgreSQL check failed");
  }

  try {
    redis = createRedisConnection({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 1000,
      retryStrategy: () => null
    });
    await redis.connect();
    await redis.ping();
    checks.redis = "ok";
    checks.queue = "ok";
    checks.webhookQueue = "ok";
    checks.campaignQueue = "ok";
  } catch (error) {
    checks.redis = "error";
    checks.queue = "error";
    checks.webhookQueue = "error";
    checks.campaignQueue = "error";
    logger.warn({ err: error, queues: [WHATSAPP_OUTBOUND_QUEUE, WHATSAPP_WEBHOOK_QUEUE, CAMPAIGN_PREPARE_QUEUE] }, "Readiness Redis/queue check failed");
  } finally {
    if (redis) {
      redis.disconnect();
    }
  }

  const ready = Object.values(checks).every((status) => status === "ok");

  res.status(ready ? 200 : 503).json({
    success: ready,
    data: {
      status: ready ? "ready" : "not_ready",
      service: "taradi-whatsapp-crm-backend",
      checks,
      queues: {
        campaignPrepare: CAMPAIGN_PREPARE_QUEUE,
        outbound: WHATSAPP_OUTBOUND_QUEUE,
        webhook: WHATSAPP_WEBHOOK_QUEUE
      }
    }
  });
});

app.use("/api", routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
