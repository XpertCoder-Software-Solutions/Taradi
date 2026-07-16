require("dotenv").config();

const { Worker } = require("bullmq");
const env = require("../config/env");
const prisma = require("../config/prisma");
const logger = require("../config/logger");
const { createRedisConnection } = require("../config/redis");
const { WHATSAPP_WEBHOOK_QUEUE } = require("../queues/whatsapp.constants");
const { processQueuedWebhookEvent } = require("../services/webhookProcessor.service");
const { closeRealtimeEventBus } = require("../realtime/eventBus");

const connection = createRedisConnection();
let isShuttingDown = false;

const worker = new Worker(
  WHATSAPP_WEBHOOK_QUEUE,
  async (job) => processQueuedWebhookEvent(job.data.auditEventId, {
    attemptsMade: job.attemptsMade,
    attempts: Number(job.opts.attempts || env.WEBHOOK_QUEUE_ATTEMPTS || 1),
    jobId: job.id
  }),
  {
    connection,
    concurrency: env.WEBHOOK_QUEUE_CONCURRENCY
  }
);

worker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, result }, "WhatsApp webhook job completed");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job && job.id, err: error }, "WhatsApp webhook job failed");
});

async function shutdown() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info("Shutting down WhatsApp webhook worker");

  try {
    await worker.close();

    if (connection.status !== "end") {
      await connection.quit();
    }

    await closeRealtimeEventBus();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Failed to shut down WhatsApp webhook worker cleanly");
    await closeRealtimeEventBus();
    await prisma.$disconnect();
    process.exit(1);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function start() {
  await prisma.$connect();
  logger.info({
    queues: [WHATSAPP_WEBHOOK_QUEUE],
    concurrency: env.WEBHOOK_QUEUE_CONCURRENCY,
    attempts: env.WEBHOOK_QUEUE_ATTEMPTS
  }, "WhatsApp webhook worker started");
}

start().catch(async (error) => {
  logger.error({ err: error }, "Failed to start WhatsApp webhook worker");
  await worker.close();
  await connection.quit();
  await closeRealtimeEventBus();
  await prisma.$disconnect();
  process.exit(1);
});
