require("dotenv").config();

const { Worker, DelayedError } = require("bullmq");
const env = require("../config/env");
const prisma = require("../config/prisma");
const logger = require("../config/logger");
const { createRedisConnection } = require("../config/redis");
const { CAMPAIGN_SEND_QUEUE } = require("../queues/whatsapp.constants");
const { processCampaignRecipient } = require("../services/campaign-send.service");
const { dispatchActiveCampaigns, closeCampaignDispatcher } = require("../services/campaign-dispatcher.service");
const { validateWhatsAppRuntimeConfig } = require("../services/whatsapp.service");

const connection = createRedisConnection();
let interval;
let isShuttingDown = false;
const worker = new Worker(CAMPAIGN_SEND_QUEUE, async (job) => {
  const result = await processCampaignRecipient(job.data.campaignId, job.data.recipientId, {
    attemptsMade: job.attemptsMade,
    attempts: Number(job.opts.attempts || env.CAMPAIGN_SEND_ATTEMPTS)
  });
  if (result.status === "RETRY") {
    await job.moveToDelayed(Date.now() + result.delayMs, job.token);
    throw new DelayedError();
  }
  await dispatchActiveCampaigns();
  return result;
}, {
  connection,
  concurrency: env.CAMPAIGN_SEND_CONCURRENCY,
  limiter: { max: env.CAMPAIGN_SEND_MAX, duration: env.CAMPAIGN_SEND_DURATION_MS }
});

worker.on("failed", (job, error) => logger.error({ err: error, jobId: job && job.id }, "Campaign send job failed"));

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (interval) clearInterval(interval);
  await worker.close();
  await closeCampaignDispatcher();
  if (connection.status !== "end") await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function start() {
  await prisma.$connect();
  validateWhatsAppRuntimeConfig();
  await dispatchActiveCampaigns();
  interval = setInterval(() => dispatchActiveCampaigns().catch((error) => logger.error({ err: error }, "Campaign recovery dispatch failed")), env.CAMPAIGN_DISPATCH_INTERVAL_MS);
  logger.info({ queue: CAMPAIGN_SEND_QUEUE, max: env.CAMPAIGN_SEND_MAX, durationMs: env.CAMPAIGN_SEND_DURATION_MS }, "Campaign send worker started");
}
start().catch(async (error) => {
  logger.error({ err: error }, "Failed to start campaign send worker");
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(1);
});
