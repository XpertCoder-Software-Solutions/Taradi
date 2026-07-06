const prisma = require("../config/prisma");
const logger = require("../config/logger");
const whatsapp = require("./whatsapp.service");
const {
  assignedUserSelect,
  contactBlockMessage,
  isCustomerContactBlocked
} = require("./customer.service");
const { notifyMessageStatus } = require("../socket");
const { pathFromMediaUrl } = require("../utils/mediaStorage");
const normalizePhone = require("../utils/normalizePhone");

async function getOutboundMessage(messageId) {
  return prisma.message.findUnique({
    where: { id: messageId },
    include: {
      customer: {
        include: {
          phones: {
            orderBy: [
              { isPrimary: "desc" },
              { position: "asc" },
              { createdAt: "asc" }
            ]
          },
          assignedTo: { select: assignedUserSelect }
        }
      },
      sentByUser: {
        select: assignedUserSelect
      }
    }
  });
}

async function updateQueuedMessage(messageId, data) {
  const message = await prisma.message.update({
    where: { id: messageId },
    data: {
      ...data,
      statusUpdatedAt: new Date()
    },
    include: {
      customer: true
    }
  });

  notifyMessageStatus(message);
  return message;
}

async function sendQueuedMessage(message) {
  if (isCustomerContactBlocked(message.customer)) {
    throw new Error(contactBlockMessage);
  }

  const recipientPhone = normalizePhone(message.customer.phone);

  if (message.type === "TEXT") {
    const response = await whatsapp.sendTextMessage(recipientPhone, message.body || message.content || "");
    return { response };
  }

  if (message.type === "TEMPLATE") {
    const payload = message.rawPayload || {};

    const response = await whatsapp.sendTemplateMessage(
      recipientPhone,
      message.templateName,
      payload.languageCode || "en_US",
      payload.components || []
    );

    return { response };
  }

  if (["IMAGE", "AUDIO", "VOICE", "DOCUMENT"].includes(message.type)) {
    const payload = message.rawPayload || {};
    let mediaId = message.mediaId;
    let uploadResponse = null;

    if (!mediaId) {
      const localPath = payload.localPath || pathFromMediaUrl(message.mediaUrl);

      if (!localPath) {
        throw new Error("Queued media message is missing local media path");
      }

      uploadResponse = await whatsapp.uploadMedia({
        localPath,
        fileName: message.fileName || "media",
        mimeType: message.mimeType,
        fileSize: message.fileSize
      });
      mediaId = uploadResponse.id;
    }

    if (!mediaId) {
      throw new Error("WhatsApp media upload did not return a media id");
    }

    if (message.type === "IMAGE") {
      const response = await whatsapp.sendImageMessage(
        recipientPhone,
        mediaId,
        message.caption || message.body || null
      );

      return { response, mediaId, uploadResponse };
    }

    if (message.type === "DOCUMENT") {
      const response = await whatsapp.sendDocumentMessage(
        recipientPhone,
        mediaId,
        message.fileName || "document",
        message.caption || message.body || null
      );

      return { response, mediaId, uploadResponse };
    }

    const response = await whatsapp.sendAudioMessage(recipientPhone, mediaId);
    return { response, mediaId, uploadResponse };
  }

  throw new Error(`Unsupported outbound message type: ${message.type}`);
}

async function processQueuedOutboundMessage(messageId) {
  const message = await getOutboundMessage(messageId);

  if (!message) {
    logger.warn({ messageId }, "Queued outbound message was not found");
    return { messageId, status: "NOT_FOUND" };
  }

  if (message.direction !== "OUTBOUND") {
    logger.warn({ messageId, direction: message.direction }, "Queued message is not outbound");
    return { messageId, status: "SKIPPED" };
  }

  if (message.status !== "QUEUED") {
    logger.info({ messageId, status: message.status }, "Queued outbound message already processed");
    return { messageId, status: message.status };
  }

  try {
    logger.info({
      messageId,
      customerId: message.customerId,
      type: message.type
    }, "Sending queued WhatsApp message");

    const result = await sendQueuedMessage(message);
    const whatsappMessageId = whatsapp.extractMessageId(result.response);
    const rawPayload = result.uploadResponse
      ? {
          mediaUpload: result.uploadResponse,
          message: result.response
        }
      : result.response;

    await updateQueuedMessage(messageId, {
      status: "SENT",
      ...(result.mediaId ? { mediaId: result.mediaId } : {}),
      whatsappMessageId: whatsappMessageId || null,
      rawPayload,
      error: null
    });

    logger.info({
      messageId,
      whatsappMessageId,
      customerId: message.customerId
    }, "Queued WhatsApp message sent");

    return { messageId, whatsappMessageId, status: "SENT" };
  } catch (error) {
    await updateQueuedMessage(messageId, {
      status: "FAILED",
      error: error.message,
      rawPayload: error.details || null
    });

    logger.error({
      err: error,
      messageId,
      customerId: message.customerId
    }, "Queued WhatsApp message failed");

    return { messageId, status: "FAILED", error: error.message };
  }
}

module.exports = {
  processQueuedOutboundMessage
};
