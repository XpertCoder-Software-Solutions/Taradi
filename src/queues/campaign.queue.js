const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const logger = require("../config/logger");
const env = require("../config/env");
const { CAMPAIGN_PREPARE_QUEUE } = require("./whatsapp.constants");

let connection = null;
let campaignPrepareQueue = null;

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
  getCampaignPrepareQueue,
  enqueueCampaignPreparation,
  closeCampaignPrepareQueue
};
