const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const logger = require("../config/logger");
const env = require("../config/env");
const { CAMPAIGN_PREPARE_QUEUE, CAMPAIGN_SEND_QUEUE } = require("./whatsapp.constants");

let connection = null;
let campaignPrepareQueue = null;
let campaignSendQueue = null;

function getCampaignPrepareQueue() {
  if (!connection) {
    connection = createRedisConnection();
  }

  if (!campaignPrepareQueue) {
    campaignPrepareQueue = new Queue(CAMPAIGN_PREPARE_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: env.CAMPAIGN_PREPARE_QUEUE_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: 5000
        }
      }
    });

    campaignPrepareQueue.on("error", (error) => {
      logger.error({ err: error, queue: CAMPAIGN_PREPARE_QUEUE }, "Campaign prepare queue error");
    });
  }

  return campaignPrepareQueue;
}

function getCampaignSendQueue() {
  if (!connection) connection = createRedisConnection();
  if (!campaignSendQueue) {
    campaignSendQueue = new Queue(CAMPAIGN_SEND_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 2000,
        removeOnFail: 5000,
        attempts: env.CAMPAIGN_SEND_ATTEMPTS,
        backoff: { type: "exponential", delay: 10000 }
      }
    });
    campaignSendQueue.on("error", (error) => logger.error({ err: error, queue: CAMPAIGN_SEND_QUEUE }, "Campaign send queue error"));
  }
  return campaignSendQueue;
}

function campaignRecipientJobId(campaignId, recipientId) {
  return `campaign:${campaignId}:recipient-${recipientId}`;
}

async function enqueueCampaignRecipient(campaignId, recipientId, options = {}) {
  return getCampaignSendQueue().add("send-campaign-recipient", { campaignId, recipientId }, {
    // BullMQ permits colon-delimited custom IDs only in three segments.
    jobId: campaignRecipientJobId(campaignId, recipientId),
    delay: Math.max(0, Number(options.delay || 0))
  });
}

async function enqueueCampaignPreparation(campaignId) {
  if (!campaignId || typeof campaignId !== "string") {
    throw new Error("A string campaignId is required to enqueue campaign preparation");
  }

  const job = await getCampaignPrepareQueue().add(
    "prepare-campaign",
    { campaignId },
    {
      jobId: `campaign-${campaignId}`
    }
  );

  logger.info({ campaignId, jobId: job.id, queue: CAMPAIGN_PREPARE_QUEUE }, "Queued campaign preparation");
  return job;
}

async function closeCampaignPrepareQueue() {
  if (campaignSendQueue) {
    await campaignSendQueue.close();
    campaignSendQueue = null;
  }
  if (campaignPrepareQueue) {
    await campaignPrepareQueue.close();
    campaignPrepareQueue = null;
  }

  if (connection && connection.status !== "end") {
    await connection.quit();
  }

  connection = null;
}

module.exports = {
  CAMPAIGN_PREPARE_QUEUE,
  CAMPAIGN_SEND_QUEUE,
  getCampaignPrepareQueue,
  getCampaignSendQueue,
  enqueueCampaignPreparation,
  enqueueCampaignRecipient,
  campaignRecipientJobId,
  closeCampaignPrepareQueue
};
