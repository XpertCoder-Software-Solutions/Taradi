const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const logger = require("../config/logger");
const { WHATSAPP_OUTBOUND_QUEUE } = require("./whatsapp.constants");

const connection = createRedisConnection();

const whatsappOutboundQueue = new Queue(WHATSAPP_OUTBOUND_QUEUE, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 1,
    backoff: {
      type: "exponential",
      delay: 5000
    }
  }
});

whatsappOutboundQueue.on("error", (error) => {
  logger.error({ err: error, queue: WHATSAPP_OUTBOUND_QUEUE }, "WhatsApp outbound queue error");
});

function assertMessageId(messageId) {
  if (!messageId || typeof messageId !== "string") {
    throw new Error("A string messageId is required to enqueue WhatsApp outbound messages");
  }
}

async function enqueueOutboundMessage(messageId) {
  assertMessageId(messageId);

  try {
    const job = await whatsappOutboundQueue.add(
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
  await whatsappOutboundQueue.close();
  await connection.quit();
}

module.exports = {
  WHATSAPP_OUTBOUND_QUEUE,
  whatsappOutboundQueue,
  enqueueOutboundMessage,
  closeWhatsAppQueue
};
