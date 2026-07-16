const prisma = require("../config/prisma");
const logger = require("../config/logger");
const whatsapp = require("./whatsapp.service");
const {
  assignedUserSelect,
  contactBlockMessage,
  isCustomerContactBlocked
} = require("./customer.service");
const {
  cleanupNormalizedAudio,
  normalizeOutboundAudio
} = require("./audioNormalization.service");
const { notifyMessageStatus } = require("../socket");
const { pathFromMediaUrl } = require("../utils/mediaStorage");
const { friendlyWhatsAppFailureMessage } = require("../utils/whatsappErrors");
const normalizePhone = require("../utils/normalizePhone");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

function getFailureMessage(error) {
  return friendlyWhatsAppFailureMessage(
    error,
    error && error.message ? error.message : "تعذر إرسال رسالة واتساب"
  );
}

function getErrorStatus(error) {
  const status = Number(error && error.status);
  return Number.isInteger(status) ? status : null;
}

function isPermanentOutboundError(error) {
  if (!error) {
    return false;
  }

  if (error.permanent === true) {
    return true;
  }

  if (error.retryable === true) {
    return false;
  }

  if (error.message === contactBlockMessage) {
    return true;
  }

  const status = getErrorStatus(error);

  if (!status) {
    return false;
  }

  if (status === 408 || status === 429) {
    return false;
  }

  return status >= 400 && status < 500;
}

function shouldRetryOutboundError(error, options = {}) {
  const attempts = Number(options.attempts || 1);
  const attemptsMade = Number(options.attemptsMade || 0);

  return attemptsMade + 1 < attempts && !isPermanentOutboundError(error);
}

function preserveOutboundSource(rawPayload) {
  return rawPayload && rawPayload.source ? {
    source: rawPayload.source,
    queued: rawPayload
  } : null;
}

function buildSuccessRawPayload(message, result) {
  const sourcePayload = preserveOutboundSource(message.rawPayload);

  if (sourcePayload || result.uploadResponse) {
    return {
      ...(sourcePayload || {}),
      ...(result.uploadResponse ? { mediaUpload: result.uploadResponse } : {}),
      message: result.response
    };
  }

  return result.response;
}

function buildFailureRawPayload(message, error, errorMessage) {
  const sourcePayload = preserveOutboundSource(message.rawPayload);
  const failurePayload = error && error.details ? error.details : null;

  if (!sourcePayload) {
    return failurePayload;
  }

  return {
    ...sourcePayload,
    errorMessage,
    error: failurePayload || {
      message: error && error.message ? error.message : errorMessage
    }
  };
}

function getOutboundRecipientPhone(customer) {
  const primaryPhone = Array.isArray(customer.phones)
    ? customer.phones.find((phone) => phone.isPrimary) || customer.phones[0]
    : null;

  return normalizePhone(primaryPhone ? primaryPhone.phoneNumber : customer.phone);
}

async function updateQueuedMessage(messageId, data) {
  const message = await prisma.message.update({
    where: { id: messageId },
    data: {
      ...data,
      statusUpdatedAt: new Date()
    },
    include: {
      customer: {
        include: {
          assignedTo: { select: assignedUserSelect }
        }
      }
    }
  });

  notifyMessageStatus(message);
  return message;
}

async function refreshCampaignProgress(campaignId) {
  if (!campaignId) {
    return null;
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }
  });

  if (!campaign) {
    return null;
  }

  const grouped = await prisma.message.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true }
  });
  const countFor = (status) => grouped.find((item) => item.status === status)?._count._all || 0;
  const queuedCount = countFor("QUEUED");
  const sentCount = countFor("SENT");
  const deliveredCount = countFor("DELIVERED");
  const readCount = countFor("READ");
  const failedCount = countFor("FAILED");
  const processedCount = sentCount + deliveredCount + readCount + failedCount;
  let status = campaign.status;
  let completedAt = campaign.completedAt;

  if (["RUNNING", "QUEUED", "READY"].includes(status) && campaign.eligibleCount > 0 && processedCount >= campaign.eligibleCount) {
    status = failedCount > 0 || campaign.skippedCount > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
    completedAt = completedAt || new Date();
  }

  return prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status,
      queuedCount,
      sentCount,
      deliveredCount,
      readCount,
      failedCount,
      pendingCount: queuedCount,
      completedAt
    }
  });
}

async function sendQueuedMessage(message) {
  if (isCustomerContactBlocked(message.customer)) {
    throw new Error(contactBlockMessage);
  }

  const recipientPhone = getOutboundRecipientPhone(message.customer);

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

  if (["IMAGE", "AUDIO", "VOICE", "VIDEO", "DOCUMENT"].includes(message.type)) {
    const payload = message.rawPayload || {};
    let mediaId = message.mediaId;
    let uploadResponse = null;

    if (!mediaId) {
      const localPath = payload.localPath || pathFromMediaUrl(message.mediaUrl);
      let normalizedAudio = null;

      if (!localPath) {
        throw new Error("Queued media message is missing local media path");
      }

      try {
        normalizedAudio = ["AUDIO", "VOICE"].includes(message.type)
          ? await normalizeOutboundAudio({
              filePath: localPath,
              fileName: message.fileName || "audio",
              mimeType: message.mimeType
            })
          : null;
        const uploadFile = normalizedAudio || {
          filePath: localPath,
          fileName: message.fileName || "media",
          mimeType: message.mimeType,
          fileSize: message.fileSize
        };

        uploadResponse = await whatsapp.uploadMedia({
          localPath: uploadFile.filePath,
          fileName: uploadFile.fileName,
          mimeType: uploadFile.mimeType,
          fileSize: uploadFile.fileSize || message.fileSize
        });
      } finally {
        await cleanupNormalizedAudio(normalizedAudio);
      }
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

    if (message.type === "VIDEO") {
      const response = await whatsapp.sendVideoMessage(
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

async function processQueuedOutboundMessage(messageId, options = {}) {
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
    const rawPayload = buildSuccessRawPayload(message, result);

    const updatedMessage = await updateQueuedMessage(messageId, {
      status: "SENT",
      ...(result.mediaId ? { mediaId: result.mediaId } : {}),
      whatsappMessageId: whatsappMessageId || null,
      rawPayload,
      error: null
    });
    await refreshCampaignProgress(updatedMessage.campaignId);

    logger.info({
      messageId,
      whatsappMessageId,
      customerId: message.customerId
    }, "Queued WhatsApp message sent");

    return { messageId, whatsappMessageId, status: "SENT" };
  } catch (error) {
    const errorMessage = getFailureMessage(error);

    if (shouldRetryOutboundError(error, options)) {
      const retryAfterMs = Number(error && error.retryAfterMs || 0);

      logger.warn({
        err: error,
        messageId,
        customerId: message.customerId,
        jobId: options.jobId || null,
        attemptsMade: options.attemptsMade || 0,
        attempts: options.attempts || 1,
        retryAfterMs
      }, "Queued WhatsApp message failed with retryable error");

      if (retryAfterMs > 0) {
        await sleep(Math.min(retryAfterMs, 60 * 1000));
      }

      throw error;
    }

    const failedMessage = await updateQueuedMessage(messageId, {
      status: "FAILED",
      error: errorMessage,
      rawPayload: buildFailureRawPayload(message, error, errorMessage)
    });
    await refreshCampaignProgress(failedMessage.campaignId);

    logger.error({
      err: error,
      messageId,
      customerId: message.customerId
    }, "Queued WhatsApp message failed");

    return { messageId, status: "FAILED", error: errorMessage };
  }
}

module.exports = {
  processQueuedOutboundMessage,
  _sendQueuedMessageForTests: sendQueuedMessage
};
