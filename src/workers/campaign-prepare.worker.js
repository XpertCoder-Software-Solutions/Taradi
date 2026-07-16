require("dotenv").config();

const { Worker } = require("bullmq");
const env = require("../config/env");
const prisma = require("../config/prisma");
const logger = require("../config/logger");
const { createRedisConnection } = require("../config/redis");
const { CAMPAIGN_PREPARE_QUEUE } = require("../queues/whatsapp.constants");
const { processCampaignPreparation } = require("../services/message.service");

const connection = createRedisConnection();
let isShuttingDown = false;

const worker = new Worker(
  CAMPAIGN_PREPARE_QUEUE,
  async (job) => processCampaignPreparation(job.data.campaignId),
  {
    connection,
    concurrency: env.CAMPAIGN_PREPARE_QUEUE_CONCURRENCY
  }
);

worker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, campaignId: job.data.campaignId, result }, "Campaign preparation job completed");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job && job.id, campaignId: job && job.data && job.data.campaignId, err: error }, "Campaign preparation job failed");
});

async function shutdown() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info("Shutting down campaign preparation worker");

  try {
    await worker.close();

    if (connection.status !== "end") {
      await connection.quit();
    }

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Failed to shut down campaign preparation worker cleanly");
    await prisma.$disconnect();
    process.exit(1);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function start() {
  await prisma.$connect();
  logger.info({
    queue: CAMPAIGN_PREPARE_QUEUE,
    concurrency: env.CAMPAIGN_PREPARE_QUEUE_CONCURRENCY,
    batchSize: env.CAMPAIGN_PREPARE_BATCH_SIZE
  }, "Campaign preparation worker started");
}

start().catch(async (error) => {
  logger.error({ err: error }, "Failed to start campaign preparation worker");
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(1);
});
