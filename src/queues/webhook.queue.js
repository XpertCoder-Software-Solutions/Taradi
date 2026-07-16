const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const logger = require("../config/logger");
const env = require("../config/env");
const { WHATSAPP_WEBHOOK_QUEUE } = require("./whatsapp.constants");

let connection = null;
let webhookQueue = null;

function getWebhookQueue() {
  if (!connection) {
    connection = createRedisConnection();
  }

  if (!webhookQueue) {
    webhookQueue = new Queue(WHATSAPP_WEBHOOK_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 5000,
        removeOnFail: 10000,
        attempts: env.WEBHOOK_QUEUE_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: env.WEBHOOK_QUEUE_BACKOFF_MS
        }
      }
    });

    webhookQueue.on("error", (error) => {
      logger.error({ err: error, queue: WHATSAPP_WEBHOOK_QUEUE }, "WhatsApp webhook queue error");
    });
  }

  return webhookQueue;
}

function buildWebhookJobId(auditEventId) {
  if (!auditEventId || typeof auditEventId !== "string") {
    throw new Error("A string auditEventId is required to enqueue webhook events");
  }

  return `webhook-event-${auditEventId}`;
}

async function enqueueWebhookEvent(auditEventId, metadata = {}) {
  const jobId = buildWebhookJobId(auditEventId);
  const queue = getWebhookQueue();
  const job = await queue.add(
    "process-whatsapp-webhook",
    {
      auditEventId,
      eventType: metadata.eventType || null,
      whatsappMessageId: metadata.whatsappMessageId || null,
      receivedAt: metadata.receivedAt || new Date().toISOString()
    },
    { jobId }
  );

  logger.info({
    auditEventId,
    jobId: job.id,
    queue: WHATSAPP_WEBHOOK_QUEUE,
    eventType: metadata.eventType || null,
    hasWhatsappMessageId: Boolean(metadata.whatsappMessageId)
  }, "Queued WhatsApp webhook event");

  return job;
}

async function closeWebhookQueue() {
  if (webhookQueue) {
    await webhookQueue.close();
    webhookQueue = null;
  }

  if (connection && connection.status !== "end") {
    await connection.quit();
  }

  connection = null;
}

module.exports = {
  WHATSAPP_WEBHOOK_QUEUE,
  buildWebhookJobId,
  enqueueWebhookEvent,
  closeWebhookQueue,
  getWebhookQueue
};
