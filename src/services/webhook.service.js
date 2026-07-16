const prisma = require("../config/prisma");
const logger = require("../config/logger");
const normalizePhone = require("../utils/normalizePhone");
const { maskPhone } = require("../utils/normalizePhone");
const {
  assignedUserSelect,
  findCustomerByPhone
} = require("./customer.service");
const conversationService = require("./conversation.service");
const mediaService = require("./media.service");
const { notifyInboundMessage, notifyMessageStatus } = require("../socket");
const {
  WHATSAPP_24H_TEXT_REJECTION_MESSAGE,
  isWhatsAppTextWindowError
} = require("../utils/whatsappErrors");

const statusMap = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED"
};

const typeMap = {
  text: "TEXT",
  image: "IMAGE",
  audio: "AUDIO",
  voice: "VOICE",
  video: "VIDEO",
  document: "DOCUMENT",
  sticker: "STICKER",
  interactive: "INTERACTIVE",
  button: "INTERACTIVE",
  system: "SYSTEM",
  unsupported: "UNKNOWN"
};

const unsupportedInboundMessageBody = "رسالة غير مدعومة من واتساب";

function mapStatus(status) {
  return statusMap[status] || "QUEUED";
}

function mapType(type, message) {
  if (type === "audio" && message && message.audio && message.audio.voice) {
    return "VOICE";
  }

  return typeMap[type] || "UNKNOWN";
}

function timestampToDate(timestamp) {
  if (!timestamp) {
    return new Date();
  }

  return new Date(Number(timestamp) * 1000);
}

function asTrimmedText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstText(...values) {
  for (const value of values) {
    const text = asTrimmedText(value);

    if (text) {
      return text;
    }
  }

  return null;
}

const readableTextKeys = [
  "body",
  "text",
  "title",
  "description",
  "payload",
  "caption",
  "filename",
  "name",
  "formatted_name",
  "first_name",
  "last_name",
  "emoji",
  "message",
  "details",
  "headline"
];

const nonContentKeys = new Set([
  "errors",
  "error_data",
  "unsupported",
  "metadata",
  "messaging_product",
  "id",
  "from",
  "to",
  "type",
  "timestamp",
  "from_user_id",
  "wa_id",
  "user_id",
  "phone_number_id",
  "display_phone_number",
  "mime_type",
  "sha256"
]);

function shouldSkipReadableKey(key) {
  const normalized = String(key || "").toLowerCase();

  return nonContentKeys.has(normalized) || normalized.endsWith("_id");
}

function extractReadableText(value, seen = new Set()) {
  const directText = asTrimmedText(value);

  if (directText) {
    return directText;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractReadableText(item, seen);

      if (text) {
        return text;
      }
    }

    return null;
  }

  for (const key of readableTextKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key) && !shouldSkipReadableKey(key)) {
      const text = extractReadableText(value[key], seen);

      if (text) {
        return text;
      }
    }
  }

  for (const [key, item] of Object.entries(value)) {
    if (shouldSkipReadableKey(key)) {
      continue;
    }

    const text = extractReadableText(item, seen);

    if (text) {
      return text;
    }
  }

  return null;
}

function getInteractiveContent(interactive) {
  if (!interactive || typeof interactive !== "object") {
    return null;
  }

  const buttonReply = interactive.button_reply;
  const listReply = interactive.list_reply;
  const flowReply = interactive.nfm_reply;

  return firstText(
    buttonReply && buttonReply.title,
    buttonReply && buttonReply.body,
    buttonReply && buttonReply.description,
    listReply && listReply.title,
    listReply && listReply.body,
    listReply && listReply.description,
    flowReply && flowReply.title,
    flowReply && flowReply.body,
    flowReply && flowReply.response_json
  ) || extractReadableText(interactive);
}

function getInboundContent(message) {
  if (!message || typeof message !== "object") {
    return unsupportedInboundMessageBody;
  }

  if (message.type === "text") {
    return firstText(message.text && message.text.body) || unsupportedInboundMessageBody;
  }

  if (message.type === "button") {
    return firstText(
      message.button && message.button.text,
      message.button && message.button.payload
    ) || unsupportedInboundMessageBody;
  }

  if (message.type === "interactive") {
    return getInteractiveContent(message.interactive) || unsupportedInboundMessageBody;
  }

  if (message.type === "unsupported") {
    return unsupportedInboundMessageBody;
  }

  if (message.image) {
    return firstText(message.image.caption);
  }

  if (message.video) {
    return firstText(message.video.caption);
  }

  if (message.document) {
    return firstText(message.document.caption);
  }

  if (message.audio || message.voice) {
    return null;
  }

  if (message.sticker) {
    return null;
  }

  if (message.location) {
    return message.location.name || message.location.address || "[location]";
  }

  if (Array.isArray(message.contacts) && message.contacts.length > 0) {
    const contact = message.contacts[0];
    return (contact.name && (contact.name.formatted_name || contact.name.first_name)) || "[contact]";
  }

  if (message.reaction) {
    return message.reaction.emoji || "[reaction]";
  }

  if (message.system) {
    return extractReadableText(message.system) || unsupportedInboundMessageBody;
  }

  if (message.referral) {
    return extractReadableText(message.referral) || unsupportedInboundMessageBody;
  }

  return extractReadableText(message) || unsupportedInboundMessageBody;
}

function getContactByWaId(contacts, waId) {
  return contacts.find((contact) => contact.wa_id === waId);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function yesNo(value) {
  return value ? "YES" : "NO";
}

function createInboundDebugState(message, context = {}) {
  const extractedBody = message ? getInboundContent(message) : null;

  return {
    timestamp: new Date().toISOString(),
    webhookField: context.webhookField || "messages",
    eventType: context.eventType || "messages",
    phoneNumber: message && message.from ? message.from : null,
    normalizedPhone: null,
    whatsappMessageId: message && message.id ? message.id : null,
    messageType: message && message.type ? message.type : null,
    availableKeys: message && typeof message === "object" ? Object.keys(message) : [],
    messageText: extractedBody,
    extractedBody,
    customerFound: "PENDING",
    conversationFound: "PENDING",
    messageCreated: "PENDING",
    socketEmitted: "PENDING",
    webhookEventId: context.webhookEventId || context.auditEventId || null,
    entryId: context.entryId || null
  };
}

async function findOrCreateInboundCustomer(message, contact, debugState) {
  const phone = normalizePhone(message.from);
  const profileName = contact && contact.profile && contact.profile.name;

  if (debugState) {
    debugState.normalizedPhone = phone;
  }

  logger.debugStep("Phone number normalized", {
    webhookEventId: debugState && debugState.webhookEventId,
    phoneNumber: message.from,
    normalizedPhone: phone,
    maskedPhone: maskPhone(phone)
  });

  const lookup = await findCustomerByPhone(phone, {
    include: {
      assignedTo: { select: assignedUserSelect }
    }
  });
  const existing = lookup.customer;

  if (debugState) {
    debugState.customerFound = yesNo(Boolean(existing));
  }

  logger.debugStep(`Customer found: ${yesNo(Boolean(existing))}`, {
    webhookEventId: debugState && debugState.webhookEventId,
    customerId: existing ? existing.id : null,
    normalizedPhone: phone,
    matchedBy: lookup.matchedBy || null
  });

  if (!existing) {
    logger.debugStep("Creating customer...", {
      webhookEventId: debugState && debugState.webhookEventId,
      normalizedPhone: phone,
      profileName: profileName || null
    });

    try {
      const created = await prisma.customer.create({
        data: {
          phone,
          name: profileName || phone,
          fullName: profileName || phone,
          accountNumber: `WA-${phone}`,
          projectName: "WhatsApp",
          debtAmount: 0,
          serviceNumber: phone,
          invoiceStatus: "UNPAID",
          source: "WHATSAPP",
          debtYear: new Date().getFullYear(),
          whatsappProfileName: profileName || null,
          phones: {
            create: {
              phoneNumber: phone,
              isPrimary: true,
              position: 0
            }
          }
        },
        include: {
          assignedTo: { select: assignedUserSelect },
          phones: {
            orderBy: [
              { isPrimary: "desc" },
              { position: "asc" },
              { createdAt: "asc" }
            ]
          }
        }
      });

      logger.info({
        customerId: created.id,
        phone: maskPhone(phone),
        hasProfileName: Boolean(profileName)
      }, "Created customer for inbound WhatsApp message");

      logger.debugStep("Created customer:", {
        webhookEventId: debugState && debugState.webhookEventId,
        customerId: created.id,
        phone: created.phone,
        whatsappProfileName: created.whatsappProfileName || null,
        assignedToId: created.assignedToId || null
      });

      return created;
    } catch (error) {
      if (error.code !== "P2002") {
        throw error;
      }

      const retryLookup = await findCustomerByPhone(phone, {
        include: {
          assignedTo: { select: assignedUserSelect }
        }
      });

      if (retryLookup.customer) {
        if (debugState) {
          debugState.customerFound = "YES";
        }

        logger.info({
          customerId: retryLookup.customer.id,
          phone: maskPhone(phone),
          matchedBy: retryLookup.matchedBy
        }, "Found customer after inbound create race");

        logger.debugStep("Customer found after create race: YES", {
          webhookEventId: debugState && debugState.webhookEventId,
          customerId: retryLookup.customer.id,
          normalizedPhone: phone,
          matchedBy: retryLookup.matchedBy || null
        });

        return retryLookup.customer;
      }

      throw error;
    }
  }

  const updateData = {
    updatedAt: new Date()
  };

  if (profileName && existing.whatsappProfileName !== profileName) {
    updateData.whatsappProfileName = profileName;
  }

  if (profileName && !existing.name) {
    updateData.name = profileName;
  }

  if (profileName && !existing.fullName) {
    updateData.fullName = profileName;
  }

  const updated = await prisma.customer.update({
    where: { id: existing.id },
    data: updateData,
    include: {
      assignedTo: { select: assignedUserSelect },
      phones: {
        orderBy: [
          { isPrimary: "desc" },
          { position: "asc" },
          { createdAt: "asc" }
        ]
      }
    }
  });

  logger.info({
    customerId: updated.id,
    phone: maskPhone(phone),
    matchedBy: lookup.matchedBy,
    assignedToId: updated.assignedToId || null
  }, "Matched customer for inbound WhatsApp message");

  logger.debugStep("Updated customer:", {
    webhookEventId: debugState && debugState.webhookEventId,
    customerId: updated.id,
    phone: updated.phone,
    matchedBy: lookup.matchedBy || null,
    assignedToId: updated.assignedToId || null,
    whatsappProfileName: updated.whatsappProfileName || null
  });

  return updated;
}

async function processInboundMessage(message, contacts, context = {}) {
  const debugState = createInboundDebugState(message, context);

  logger.debugStep("Inbound webhook message parsed", debugState);

  if (!message.id || !message.from) {
    debugState.customerFound = "NO";
    debugState.conversationFound = "NO";
    debugState.messageCreated = "NO";
    debugState.socketEmitted = "NO";

    logger.warn({
      hasId: Boolean(message.id),
      hasFrom: Boolean(message.from),
      type: message.type || null
    }, "Ignoring inbound WhatsApp message without id or sender");

    logger.debugStep("Decision: missing WhatsApp message id or sender", {
      webhookEventId: debugState.webhookEventId,
      hasId: Boolean(message.id),
      hasFrom: Boolean(message.from),
      messageType: message.type || null
    });

    logger.debugStep("Inbound webhook processing summary", debugState);

    return {
      ignored: true,
      reason: "missing_id_or_sender"
    };
  }

  logger.info({
    whatsappMessageId: message.id,
    type: message.type || null,
    from: maskPhone(message.from),
    hasText: Boolean(message.text && message.text.body)
  }, "Parsed inbound WhatsApp message");

  const duplicate = await prisma.message.findUnique({
    where: { whatsappMessageId: message.id },
    select: {
      id: true,
      customerId: true
    }
  });

  if (duplicate) {
    debugState.customerFound = duplicate.customerId ? "SKIPPED_DUPLICATE" : "UNKNOWN";
    debugState.conversationFound = "SKIPPED_DUPLICATE";
    debugState.messageCreated = "NO";
    debugState.socketEmitted = "NO";

    logger.info({
      whatsappMessageId: message.id,
      messageId: duplicate.id,
      customerId: duplicate.customerId
    }, "Ignored duplicate inbound WhatsApp message");

    logger.debugStep("Decision: duplicate inbound WhatsApp message", {
      webhookEventId: debugState.webhookEventId,
      whatsappMessageId: message.id,
      existingMessageId: duplicate.id,
      customerId: duplicate.customerId
    });

    logger.debugStep("Inbound webhook processing summary", debugState);

    return {
      id: duplicate.id,
      customerId: duplicate.customerId,
      duplicate: true
    };
  }

  const contact = getContactByWaId(contacts, message.from);
  const customer = await findOrCreateInboundCustomer(message, contact, debugState);

  let existingConversation = null;
  if (logger.isDebugMode) {
    existingConversation = await prisma.conversation.findUnique({
      where: { activeKey: customer.id },
      select: {
        id: true,
        customerId: true,
        assignedEmployeeId: true,
        unreadCount: true,
        status: true
      }
    });

    debugState.conversationFound = yesNo(Boolean(existingConversation));

    logger.debugStep(`Conversation found: ${yesNo(Boolean(existingConversation))}`, {
      webhookEventId: debugState.webhookEventId,
      customerId: customer.id,
      conversationId: existingConversation ? existingConversation.id : null,
      assignedEmployeeId: existingConversation ? existingConversation.assignedEmployeeId : null,
      unreadCount: existingConversation ? existingConversation.unreadCount : null
    });

    if (!existingConversation) {
      logger.debugStep("Creating conversation...", {
        webhookEventId: debugState.webhookEventId,
        customerId: customer.id,
        assignedEmployeeId: customer.assignedToId || null
      });
    }
  }

  const conversation = await conversationService.ensureConversationForCustomer(customer.id);

  if (logger.isDebugMode && !existingConversation) {
    logger.debugStep("Created conversation:", {
      webhookEventId: debugState.webhookEventId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      assignedEmployeeId: conversation.assignedEmployeeId || null,
      status: conversation.status,
      unreadCount: conversation.unreadCount
    });
  } else if (logger.isDebugMode && existingConversation) {
    logger.debugStep("Updated conversation:", {
      webhookEventId: debugState.webhookEventId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      assignedEmployeeId: conversation.assignedEmployeeId || null,
      previousAssignedEmployeeId: existingConversation.assignedEmployeeId || null,
      status: conversation.status,
      unreadCount: conversation.unreadCount
    });
  }

  logger.info({
    customerId: customer.id,
    conversationId: conversation.id,
    assignedToId: conversation.assignedEmployeeId || null
  }, "Resolved conversation for inbound WhatsApp message");
  const extractedInboundMedia = mediaService.extractInboundMedia(message);

  if (extractedInboundMedia && extractedInboundMedia.messageType === "IMAGE") {
    logger.debugStep("Inbound image media id extracted", {
      webhookEventId: debugState.webhookEventId,
      whatsappMessageId: message.id,
      mediaId: extractedInboundMedia.mediaId,
      mimeType: extractedInboundMedia.mimeType,
      caption: extractedInboundMedia.caption
    });
  }

  const inboundMedia = await mediaService.downloadInboundMedia(
    extractedInboundMedia
  );
  const content = inboundMedia ? inboundMedia.caption || null : getInboundContent(message);
  const messageAt = timestampToDate(message.timestamp);
  const availableKeys = message && typeof message === "object" ? Object.keys(message) : [];

  debugState.messageText = content;
  debugState.availableKeys = availableKeys;
  debugState.extractedBody = content;

  logger.info({
    whatsappMessageId: message.id,
    inboundType: message.type || "unknown",
    availableKeys,
    extractedBody: content
  }, "Extracted inbound WhatsApp message body");

  logger.debugStep("Inbound message body extracted", {
    webhookEventId: debugState.webhookEventId,
    whatsappMessageId: message.id,
    inboundType: message.type || "unknown",
    availableKeys,
    extractedBody: content
  });

  try {
    logger.debugStep("Creating message...", {
      webhookEventId: debugState.webhookEventId,
      whatsappMessageId: message.id,
      customerId: customer.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      type: inboundMedia ? inboundMedia.messageType : mapType(message.type, message),
      status: "RECEIVED"
    });

    const created = await prisma.message.create({
      data: {
        customerId: customer.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        type: inboundMedia ? inboundMedia.messageType : mapType(message.type, message),
        content,
        body: content,
        mediaUrl: inboundMedia && inboundMedia.mediaUrl ? inboundMedia.mediaUrl : null,
        mediaId: inboundMedia && inboundMedia.mediaId ? inboundMedia.mediaId : null,
        mimeType: inboundMedia && inboundMedia.mimeType ? inboundMedia.mimeType : null,
        fileName: inboundMedia && inboundMedia.fileName ? inboundMedia.fileName : null,
        fileSize: inboundMedia && inboundMedia.fileSize ? inboundMedia.fileSize : null,
        caption: inboundMedia && inboundMedia.caption ? inboundMedia.caption : null,
        duration: inboundMedia && inboundMedia.duration ? inboundMedia.duration : null,
        whatsappMessageId: message.id,
        status: "RECEIVED",
        statusUpdatedAt: messageAt,
        rawPayload: message
      },
      include: {
        customer: {
          include: {
            assignedTo: { select: assignedUserSelect }
          }
        }
      }
    });

    debugState.messageCreated = "YES";

    logger.debugStep("Created message:", {
      webhookEventId: debugState.webhookEventId,
      messageId: created.id,
      whatsappMessageId: message.id,
      customerId: customer.id,
      conversationId: conversation.id,
      direction: created.direction,
      type: created.type,
      mediaId: created.mediaId,
      mediaUrl: created.mediaUrl,
      mimeType: created.mimeType,
      fileSize: created.fileSize,
      status: created.status
    });

    const updatedConversation = await conversationService.touchConversationForMessage({
      customerId: customer.id,
      messageId: created.id,
      messageAt,
      direction: "INBOUND"
    });

    logger.debugStep("Updated unread count:", {
      webhookEventId: debugState.webhookEventId,
      conversationId: updatedConversation.id,
      previousUnreadCount: conversation.unreadCount,
      unreadCount: updatedConversation.unreadCount,
      lastMessageId: updatedConversation.lastMessageId,
      lastMessageAt: updatedConversation.lastMessageAt,
      status: updatedConversation.status
    });

    logger.info({
      messageId: created.id,
      whatsappMessageId: message.id,
      customerId: customer.id,
      conversationId: updatedConversation.id,
      unreadCount: updatedConversation.unreadCount
    }, "Created inbound WhatsApp message record");

    const socketResult = await notifyInboundMessage(created.customer, created, updatedConversation);
    debugState.socketEmitted = socketResult && socketResult.published && !socketResult.emitted
      ? "PUBLISHED"
      : yesNo(Boolean(socketResult && socketResult.emitted));

    logger.debugStep(`Socket emitted: ${debugState.socketEmitted}`, {
      webhookEventId: debugState.webhookEventId,
      whatsappMessageId: message.id,
      conversationId: updatedConversation.id,
      customerId: customer.id,
      emitted: Boolean(socketResult && socketResult.emitted),
      targets: socketResult && socketResult.targets ? socketResult.targets : []
    });

    logger.info({
      whatsappMessageId: message.id,
      customerId: customer.id,
      conversationId: conversation.id,
      type: message.type
    }, "Stored inbound WhatsApp message");

    logger.debugStep("Inbound webhook processing summary", debugState);

    return {
      id: created.id,
      customerId: customer.id,
      duplicate: false
    };
  } catch (error) {
    if (error.code !== "P2002") {
      throw error;
    }

    const existing = await prisma.message.findUnique({
      where: { whatsappMessageId: message.id }
    });

    debugState.messageCreated = "NO";
    debugState.socketEmitted = "NO";

    logger.info({
      whatsappMessageId: message.id,
      messageId: existing && existing.id,
      customerId: customer.id
    }, "Ignored duplicate inbound WhatsApp message");

    logger.debugStep("Decision: duplicate inbound WhatsApp message during create", {
      webhookEventId: debugState.webhookEventId,
      whatsappMessageId: message.id,
      existingMessageId: existing && existing.id,
      customerId: customer.id
    });

    logger.debugStep("Inbound webhook processing summary", debugState);

    return {
      id: existing && existing.id,
      customerId: customer.id,
      duplicate: true
    };
  }
}

async function processStatus(status) {
  if (!status.id || !status.status) {
    logger.warn({
      hasId: Boolean(status.id),
      hasStatus: Boolean(status.status)
    }, "Ignoring WhatsApp status without id or status");
    return {
      ignored: true,
      reason: "missing_id_or_status"
    };
  }

  const existing = await prisma.message.findUnique({
    where: {
      whatsappMessageId: status.id
    },
    include: {
      customer: true
    }
  });

  if (!existing) {
    logger.info({
      whatsappMessageId: status.id,
      status: status.status
    }, "Received status for unknown outbound WhatsApp message");

    return {
      whatsappMessageId: status.id,
      updated: false
    };
  }

  const data = {
    status: mapStatus(status.status),
    statusUpdatedAt: timestampToDate(status.timestamp),
    rawPayload: status
  };

  if (status.errors && status.errors.length > 0) {
    data.error = status.errors.some((item) => isWhatsAppTextWindowError(item))
      ? WHATSAPP_24H_TEXT_REJECTION_MESSAGE
      : status.errors.map((item) => item.message || item.title || item.code).join("; ");
  }

  const message = await prisma.message.update({
    where: { id: existing.id },
    data,
    include: {
      customer: {
        include: {
          assignedTo: { select: assignedUserSelect }
        }
      }
    }
  });

  await notifyMessageStatus(message);

  logger.info({
    whatsappMessageId: status.id,
    messageId: message.id,
    status: message.status
  }, "Updated WhatsApp message status");

  return {
    whatsappMessageId: status.id,
    messageId: message.id,
    updated: true,
    status: message.status
  };
}

async function processWebhook(body) {
  if (!isObject(body)) {
    logger.warn({ bodyType: typeof body }, "Ignoring non-object WhatsApp webhook payload");
    return {
      inboundMessages: [],
      statuses: [],
      ignored: [{ reason: "non_object_payload" }]
    };
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  const summary = {
    inboundMessages: [],
    statuses: [],
    ignored: []
  };

  if (entries.length === 0) {
    logger.info({
      object: body.object || null,
      keys: Object.keys(body)
    }, "Received WhatsApp webhook without entries");
    summary.ignored.push({ reason: "no_entries" });
    return summary;
  }

  for (const entry of entries) {
    const safeEntry = isObject(entry) ? entry : {};
    const changes = Array.isArray(safeEntry.changes) ? safeEntry.changes : [];

    if (changes.length === 0) {
      logger.info({ entryId: safeEntry.id || null }, "Received WhatsApp webhook entry without changes");
      summary.ignored.push({ entryId: safeEntry.id || null, reason: "no_changes" });
    }

    for (const change of changes) {
      const safeChange = isObject(change) ? change : {};
      const value = isObject(safeChange.value) ? safeChange.value : {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];

      logger.info({
        entryId: safeEntry.id || null,
        field: safeChange.field || null,
        inboundCount: messages.length,
        statusCount: statuses.length
      }, "Processing WhatsApp webhook change");

      if (messages.length === 0 && statuses.length === 0) {
        summary.ignored.push({
          entryId: safeEntry.id || null,
          field: safeChange.field || null,
          reason: "no_messages_or_statuses"
        });
      }

      for (const message of messages) {
        const result = await processInboundMessage(message, contacts);
        if (result.ignored) {
          summary.ignored.push(result);
        } else {
          summary.inboundMessages.push(result);
        }
      }

      for (const status of statuses) {
        const result = await processStatus(status);
        if (result.ignored) {
          summary.ignored.push(result);
        } else {
          summary.statuses.push(result);
        }
      }
    }
  }

  return summary;
}

module.exports = {
  processWebhook,
  processInboundMessage,
  processStatus,
  getInboundContent,
  extractReadableText,
  unsupportedInboundMessageBody
};
