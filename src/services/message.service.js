const prisma = require("../config/prisma");
const env = require("../config/env");
const logger = require("../config/logger");
const {
  assignedUserSelect,
  customerAccessWhere,
  contactBlockMessage,
  getCollectionStatusLabel,
  getCustomerForUser,
  isCustomerContactBlocked
} = require("./customer.service");
const conversationService = require("./conversation.service");
const mediaService = require("./media.service");
const ApiError = require("../utils/apiError");
const { notifyOutboundMessage, notifyMessageStatus } = require("../socket");
const { enqueueOutboundMessage } = require("../queues/whatsapp.queue");
const { WHATSAPP_OUTBOUND_QUEUE } = require("../queues/whatsapp.constants");
const { safeRecordEmployeeActivity } = require("./employeeActivity.service");

function getQueueErrorMessage(error) {
  return error && error.message ? error.message : "Unknown queue error";
}

function buildQueueErrorDetails(messageId, error) {
  const details = {
    messageId,
    queue: WHATSAPP_OUTBOUND_QUEUE
  };

  if (env.NODE_ENV !== "production") {
    details.queueError = getQueueErrorMessage(error);
    details.queueErrorCode = error && error.code ? error.code : undefined;
  }

  return [details];
}

async function getInbox(user, query) {
  return conversationService.listConversations(user, query);
}

async function listMessages(customerId, user, query) {
  await getCustomerForUser(customerId, user);

  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
  const cursor = query.cursor;

  const messages = await prisma.message.findMany({
    where: { customerId },
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    include: {
      sentByUser: {
        select: assignedUserSelect
      }
    }
  });
  const nextCursor = messages.length === limit ? messages[messages.length - 1].id : null;

  return {
    items: [...messages].reverse(),
    meta: {
      limit,
      nextCursor
    }
  };
}

async function markConversationRead(customerId, user) {
  const result = await conversationService.markConversationRead(customerId, user);
  return result.readState;
}

async function createOutboundRecord(customer, user, data) {
  const conversation = await conversationService.ensureConversationForCustomer(customer.id);
  const message = await prisma.message.create({
    data: {
      customerId: customer.id,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      type: data.type,
      content: data.content,
      body: data.body || data.content || null,
      mediaUrl: data.mediaUrl || null,
      mediaId: data.mediaId || null,
      mimeType: data.mimeType || null,
      fileName: data.fileName || null,
      fileSize: data.fileSize || null,
      caption: data.caption || null,
      duration: data.duration || null,
      templateName: data.templateName,
      whatsappMessageId: data.whatsappMessageId || null,
      status: data.status,
      sentByUserId: user.id,
      rawPayload: data.rawPayload || null,
      error: data.error || null,
      statusUpdatedAt: new Date()
    },
    include: {
      customer: {
        include: {
          assignedTo: { select: assignedUserSelect }
        }
      },
      sentByUser: {
        select: assignedUserSelect
      }
    }
  });

  await conversationService.touchConversationForMessage({
    customerId: customer.id,
    messageId: message.id,
    messageAt: message.createdAt,
    direction: "OUTBOUND"
  });

  await prisma.customer.update({
    where: { id: customer.id },
    data: { updatedAt: new Date() }
  });

  await safeRecordEmployeeActivity(user, "SENT_MESSAGE", message.createdAt);

  notifyOutboundMessage(message.customer, message);
  return message;
}

async function markOutboundEnqueueFailed(messageId, error) {
  const errorMessage = `Queue enqueue failed: ${getQueueErrorMessage(error)}`;
  const message = await prisma.message.update({
    where: { id: messageId },
    data: {
      status: "FAILED",
      error: errorMessage,
      statusUpdatedAt: new Date()
    },
    include: {
      customer: true
    }
  });

  notifyMessageStatus(message);
  return message;
}

async function sendManualReply(customerId, user, text) {
  const customer = await getCustomerForUser(customerId, user);

  if (isCustomerContactBlocked(customer)) {
    throw new ApiError(403, contactBlockMessage);
  }

  const message = await createOutboundRecord(customer, user, {
    type: "TEXT",
    content: text,
    status: "QUEUED",
    rawPayload: {
      queuedAt: new Date().toISOString()
    }
  });

  let job;

  try {
    job = await enqueueOutboundMessage(message.id);
  } catch (error) {
    logger.error({
      err: error,
      messageId: message.id,
      customerId,
      queue: WHATSAPP_OUTBOUND_QUEUE
    }, "Failed to queue manual WhatsApp reply");

    await markOutboundEnqueueFailed(message.id, error);
    throw new ApiError(503, "Failed to queue WhatsApp message", buildQueueErrorDetails(message.id, error));
  }

  return {
    message,
    job: {
      id: job.id,
      queue: WHATSAPP_OUTBOUND_QUEUE
    }
  };
}

async function sendManualMedia(customerId, user, data) {
  const customer = await getCustomerForUser(customerId, user);

  if (isCustomerContactBlocked(customer)) {
    throw new ApiError(403, contactBlockMessage);
  }

  const media = await mediaService.saveUploadedMedia({
    mediaType: data.type,
    file: data.file
  });

  const caption = data.caption || null;
  const message = await createOutboundRecord(customer, user, {
    type: media.messageType,
    content: caption,
    body: caption,
    status: "QUEUED",
    mediaUrl: media.mediaUrl,
    mimeType: media.mimeType,
    fileName: media.fileName,
    fileSize: media.fileSize,
    caption,
    rawPayload: {
      localPath: media.localPath,
      mediaUrl: media.mediaUrl,
      queuedAt: new Date().toISOString()
    }
  });

  let job;

  try {
    job = await enqueueOutboundMessage(message.id);
  } catch (error) {
    logger.error({
      err: error,
      messageId: message.id,
      customerId,
      queue: WHATSAPP_OUTBOUND_QUEUE
    }, "Failed to queue manual WhatsApp media message");

    await markOutboundEnqueueFailed(message.id, error);
    throw new ApiError(503, "Failed to queue WhatsApp media message", buildQueueErrorDetails(message.id, error));
  }

  return {
    message,
    job: {
      id: job.id,
      queue: WHATSAPP_OUTBOUND_QUEUE
    }
  };
}

async function sendBulkTemplate(user, data) {
  const uniqueCustomerIds = [...new Set(data.customerIds)];
  const where = {
    id: { in: uniqueCustomerIds },
    ...customerAccessWhere(user)
  };

  const customers = await prisma.customer.findMany({
    where,
    include: {
      phones: {
        orderBy: [
          { isPrimary: "desc" },
          { position: "asc" },
          { createdAt: "asc" }
        ]
      }
    }
  });

  if (customers.length !== uniqueCustomerIds.length) {
    throw new ApiError(403, "One or more customers are not accessible");
  }

  const blockedCustomers = customers.filter((customer) => isCustomerContactBlocked(customer));
  const eligibleCustomers = customers.filter((customer) => (
    !isCustomerContactBlocked(customer)
  ));
  const excludedCustomers = blockedCustomers.map((customer) => ({
    customerId: customer.id,
    fullName: customer.fullName || customer.name || customer.whatsappProfileName || customer.phone,
    reason: getCollectionStatusLabel(customer.collectionStatus)
  }));
  const results = [];

  for (const customer of eligibleCustomers) {
    const message = await createOutboundRecord(customer, user, {
      type: "TEMPLATE",
      content: data.templateName,
      templateName: data.templateName,
      status: "QUEUED",
      rawPayload: {
        templateName: data.templateName,
        languageCode: data.languageCode,
        components: data.components || [],
        queuedAt: new Date().toISOString()
      }
    });

    try {
      const job = await enqueueOutboundMessage(message.id);

      results.push({
        customerId: customer.id,
        messageId: message.id,
        jobId: job.id,
        status: "QUEUED"
      });
    } catch (error) {
      logger.error({
        err: error,
        messageId: message.id,
        customerId: customer.id,
        queue: WHATSAPP_OUTBOUND_QUEUE
      }, "Failed to queue bulk WhatsApp template message");

      await markOutboundEnqueueFailed(message.id, error);

      results.push({
        customerId: customer.id,
        messageId: message.id,
        status: "FAILED",
        error: env.NODE_ENV === "production"
          ? "Failed to queue WhatsApp message"
          : getQueueErrorMessage(error)
      });
    }
  }

  return {
    totalSelected: uniqueCustomerIds.length,
    eligibleRecipients: eligibleCustomers.length,
    excludedBlockedCustomers: blockedCustomers.length,
    excludedCustomers,
    total: results.length,
    queued: results.filter((result) => result.status === "QUEUED").length,
    failed: results.filter((result) => result.status === "FAILED").length,
    results
  };
}

module.exports = {
  getInbox,
  listMessages,
  markConversationRead,
  sendManualReply,
  sendManualMedia,
  sendBulkTemplate
};
