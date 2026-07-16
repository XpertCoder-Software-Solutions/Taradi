const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const logger = require("../config/logger");
const env = require("../config/env");
const { WHATSAPP_OUTBOUND_QUEUE } = require("./whatsapp.constants");

let connection = null;
let whatsappOutboundQueue = null;

function getWhatsAppQueue() {
  if (!connection) {
    connection = createRedisConnection();
  }

  if (!whatsappOutboundQueue) {
    whatsappOutboundQueue = new Queue(WHATSAPP_OUTBOUND_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: env.WHATSAPP_QUEUE_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: 5000
        }
      }
    });

    whatsappOutboundQueue.on("error", (error) => {
      logger.error({ err: error, queue: WHATSAPP_OUTBOUND_QUEUE }, "WhatsApp outbound queue error");
    });
  }

  return whatsappOutboundQueue;
}

function assertMessageId(messageId) {
  if (!messageId || typeof messageId !== "string") {
    throw new Error("A string messageId is required to enqueue WhatsApp outbound messages");
  }
}

async function enqueueOutboundMessage(messageId) {
  assertMessageId(messageId);

  try {
    const job = await getWhatsAppQueue().add(
      "send-whatsapp-message",
      { messageId },
      {
        jobId: `message-${messageId}`
      }
    );

    logger.info({ messageId, jobId: job.id, queue: WHATSAPP_OUTBOUND_QUEUE }, "Queued outbound WhatsApp message");
    return job;
  } catch (error) {
    logger.error({
      err: error,
      messageId,
      queue: WHATSAPP_OUTBOUND_QUEUE
    }, "Failed to enqueue outbound WhatsApp message");

    throw error;
  }
}

async function closeWhatsAppQueue() {
  if (whatsappOutboundQueue) {
    await whatsappOutboundQueue.close();
    whatsappOutboundQueue = null;
  }

  if (connection && connection.status !== "end") {
    await connection.quit();
  }

  connection = null;
}

module.exports = {
  WHATSAPP_OUTBOUND_QUEUE,
  getWhatsAppQueue,
  enqueueOutboundMessage,
  closeWhatsAppQueue
};
