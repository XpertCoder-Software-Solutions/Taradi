require("dotenv").config();

const { Worker } = require("bullmq");
const env = require("../config/env");
const prisma = require("../config/prisma");
const logger = require("../config/logger");
const { createRedisConnection } = require("../config/redis");
const { WHATSAPP_OUTBOUND_QUEUE } = require("../queues/whatsapp.constants");
const { validateWhatsAppRuntimeConfig } = require("../services/whatsapp.service");
const { processQueuedOutboundMessage } = require("../services/outbound.service");
const { closeRealtimeEventBus } = require("../realtime/eventBus");

const connection = createRedisConnection();
let isShuttingDown = false;

const worker = new Worker(
  WHATSAPP_OUTBOUND_QUEUE,
  async (job) => {
    return processQueuedOutboundMessage(job.data.messageId, {
      attemptsMade: job.attemptsMade,
      attempts: Number(job.opts.attempts || env.WHATSAPP_QUEUE_ATTEMPTS || 1),
      jobId: job.id
    });
  },
  {
    connection,
    concurrency: env.WHATSAPP_SEND_CONCURRENCY,
    limiter: {
      max: env.WHATSAPP_SEND_RATE_PER_SECOND,
      duration: 1000
    }
  }
);

worker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, result }, "WhatsApp outbound job completed");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job && job.id, err: error }, "WhatsApp outbound job failed");
});

async function shutdown() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info("Shutting down WhatsApp worker");

  try {
    await worker.close();

    if (connection.status !== "end") {
      await connection.quit();
    }

    await closeRealtimeEventBus();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Failed to shut down WhatsApp worker cleanly");
    await closeRealtimeEventBus();
    await prisma.$disconnect();
    process.exit(1);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function start() {
  await prisma.$connect();
  validateWhatsAppRuntimeConfig();
  logger.info({
    queues: [WHATSAPP_OUTBOUND_QUEUE],
    concurrency: env.WHATSAPP_SEND_CONCURRENCY,
    ratePerSecond: env.WHATSAPP_SEND_RATE_PER_SECOND
  }, "WhatsApp worker started");
}

start().catch(async (error) => {
  logger.error({ err: error }, "Failed to start WhatsApp worker");
  await worker.close();
  await connection.quit();
  await closeRealtimeEventBus();
  await prisma.$disconnect();
  process.exit(1);
});
