const crypto = require("crypto");
const fs = require("fs");
const prisma = require("../config/prisma");
const env = require("../config/env");
const logger = require("../config/logger");
const {
  assignedUserSelect,
  buildCustomerWhere,
  customerInclude,
  contactBlockMessage,
  findCustomerByPhone,
  formatCustomer,
  getCollectionStatusLabel,
  getCustomerForUser,
  isCustomerContactBlocked
} = require("./customer.service");
const conversationService = require("./conversation.service");
const { assertAssignableStaff } = require("./employee.service");
const mediaService = require("./media.service");
const ApiError = require("../utils/apiError");
const normalizePhone = require("../utils/normalizePhone");
const { safeNormalizePhone } = require("../utils/normalizePhone");
const { friendlyWhatsAppFailureMessage } = require("../utils/whatsappErrors");
const { notifyOutboundMessage, notifyMessageStatus } = require("../socket");
const { enqueueOutboundMessage } = require("../queues/whatsapp.queue");
const { enqueueCampaignPreparation } = require("../queues/campaign.queue");
const { CAMPAIGN_PREPARE_QUEUE, WHATSAPP_OUTBOUND_QUEUE } = require("../queues/whatsapp.constants");
const { pathFromMediaUrl } = require("../utils/mediaStorage");
const { safeRecordEmployeeActivity } = require("./employeeActivity.service");
const {
  buildMappingStatus,
  buildTemplateComponents,
  buildTemplatePreview,
  resolveTemplateForCustomer,
  sanitizeCustomerSnapshot
} = require("../modules/templates/templateMapping.service");

const terminalCampaignStatuses = new Set(["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"]);

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

function normalizeQuickSendPhone(phoneInput) {
  let phone;

  try {
    phone = normalizePhone(phoneInput);
  } catch (error) {
    throw new ApiError(400, "رقم الهاتف غير صحيح");
  }

  if (phone.length < 6) {
    throw new ApiError(400, "رقم الهاتف غير صحيح");
  }

  return phone;
}

function getScopedAssigneeIds(user) {
  if (user.role === "ADMIN") {
    return null;
  }

  if (user.role === "SUPERVISOR") {
    return [user.id, ...(user.teamMemberIds || [])];
  }

  return [user.id];
}

async function resolveQuickSendAssignment(user, assignedToId) {
  if (user.role === "EMPLOYEE") {
    if (assignedToId && assignedToId !== user.id) {
      throw new ApiError(403, "الموظف يمكنه الإسناد لنفسه فقط");
    }

    return user.id;
  }

  if (user.role === "SUPERVISOR") {
    if (!assignedToId) {
      return user.id;
    }

    const assignee = await assertAssignableStaff(assignedToId, user);
    return assignee.id;
  }

  if (!assignedToId) {
    return null;
  }

  const assignee = await assertAssignableStaff(assignedToId, user);
  return assignee.id;
}

function assertQuickSendCustomerAccess(customer, user) {
  if (user.role === "ADMIN") {
    return;
  }

  if (user.role === "EMPLOYEE") {
    if (customer.assignedToId === user.id) {
      return;
    }

    if (customer.assignedToId) {
      throw new ApiError(403, "هذا الرقم مسند إلى موظف آخر ولا يمكنك الإرسال إليه");
    }

    throw new ApiError(403, "لا يمكن إرسال رسالة لهذا الرقم لأنه غير مسند إليك");
  }

  const scopedAssigneeIds = getScopedAssigneeIds(user);

  if (customer.assignedToId && scopedAssigneeIds.includes(customer.assignedToId)) {
    return;
  }

  throw new ApiError(403, "لا تملك صلاحية الإرسال لهذا العميل");
}

function buildQuickSendCustomerData(phone, user, assignedToId) {
  const accountSuffix = crypto.randomUUID().slice(0, 8).toUpperCase();

  return {
    phone,
    name: "عميل جديد",
    fullName: "عميل جديد",
    accountNumber: `QS-${phone}-${accountSuffix}`,
    projectName: "إرسال سريع",
    debtAmount: 0,
    serviceNumber: phone,
    invoiceStatus: "UNPAID",
    collectionStatus: "ACTIVE_DEBT",
    source: "QUICK_SEND",
    debtYear: new Date().getFullYear(),
    notes: "تم إنشاء العميل عبر الإرسال السريع",
    tags: ["QUICK_SEND"],
    assignedToId,
    createdById: user.id,
    phones: {
      create: {
        phoneNumber: phone,
        isPrimary: true,
        position: 0
      }
    }
  };
}

async function createQuickSendCustomer(phone, user, assignedToId) {
  return prisma.customer.create({
    data: buildQuickSendCustomerData(phone, user, assignedToId),
    include: customerInclude()
  });
}

async function findOrCreateQuickSendCustomer(phone, user, assignedToId) {
  const lookup = await findCustomerByPhone(phone, {
    include: customerInclude()
  });

  if (lookup.customer) {
    assertQuickSendCustomerAccess(lookup.customer, user);
    return {
      customer: lookup.customer,
      created: false,
      matchedBy: lookup.matchedBy
    };
  }

  try {
    const customer = await createQuickSendCustomer(phone, user, assignedToId);

    return {
      customer,
      created: true,
      matchedBy: null
    };
  } catch (error) {
    if (error.code !== "P2002") {
      throw error;
    }

    const retryLookup = await findCustomerByPhone(phone, {
      include: customerInclude()
    });

    if (!retryLookup.customer) {
      throw error;
    }

    assertQuickSendCustomerAccess(retryLookup.customer, user);

    return {
      customer: retryLookup.customer,
      created: false,
      matchedBy: retryLookup.matchedBy
    };
  }
}

async function enqueueMessageOrFail(message, context) {
  try {
    const job = await enqueueOutboundMessage(message.id);

    return {
      id: job.id,
      queue: WHATSAPP_OUTBOUND_QUEUE
    };
  } catch (error) {
    logger.error({
      err: error,
      messageId: message.id,
      customerId: context.customerId,
      queue: WHATSAPP_OUTBOUND_QUEUE
    }, context.logMessage);

    await markOutboundEnqueueFailed(message.id, error);
    throw new ApiError(503, context.clientMessage, buildQueueErrorDetails(message.id, error));
  }
}

async function getInbox(user, query) {
  return conversationService.listConversations(user, query);
}

async function listMessages(customerId, user, query) {
  await getCustomerForUser(customerId, user);
  const conversation = await conversationService.getConversationForUser(customerId, user, {
    conversationId: query.conversationId || null
  });

  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
  const cursor = query.cursor;

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { conversationId: conversation.id },
        { customerId, conversationId: null }
      ]
    },
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
    items: [...messages].reverse().map((message) => ({
      ...message,
      error: friendlyWhatsAppFailureMessage(message.error, message.error)
    })),
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
      campaignId: data.campaignId || null,
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
  const job = await enqueueMessageOrFail(message, {
    customerId,
    logMessage: "Failed to queue manual WhatsApp reply",
    clientMessage: "Failed to queue WhatsApp message"
  });

  return {
    message,
    job
  };
}

async function quickSend(user, data) {
  const phone = normalizeQuickSendPhone(data.phone);
  const assignedToId = await resolveQuickSendAssignment(user, data.assignedToId || null);
  const { customer, created } = await findOrCreateQuickSendCustomer(phone, user, assignedToId);

  if (isCustomerContactBlocked(customer)) {
    throw new ApiError(403, contactBlockMessage);
  }

  const conversation = await conversationService.ensureConversationForCustomer(customer.id, {
    assignedEmployeeId: created ? assignedToId : customer.assignedToId || null,
    include: conversationService.conversationInclude()
  });

  const message = await createOutboundRecord(customer, user, {
    type: "TEXT",
    content: data.message,
    status: "QUEUED",
    rawPayload: {
      queuedAt: new Date().toISOString(),
      source: "QUICK_SEND",
      phone
    }
  });
  const job = await enqueueMessageOrFail(message, {
    customerId: customer.id,
    logMessage: "Failed to queue quick WhatsApp message",
    clientMessage: "Failed to queue WhatsApp message"
  });
  const [freshCustomer, freshConversation] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customer.id },
      include: customerInclude()
    }),
    prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: conversationService.conversationInclude()
    })
  ]);

  logger.info({
    userId: user.id,
    customerId: customer.id,
    conversationId: conversation.id,
    messageId: message.id
  }, "Queued quick WhatsApp send");

  return {
    customer: formatCustomer(freshCustomer || customer),
    conversation: conversationService.formatConversation(freshConversation || conversation),
    message,
    job
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
  const job = await enqueueMessageOrFail(message, {
    customerId,
    logMessage: "Failed to queue manual WhatsApp media message",
    clientMessage: "Failed to queue WhatsApp media message"
  });

  return {
    message,
    job
  };
}

async function recordSentTemplateMessage(customer, user, data) {
  return createOutboundRecord(customer, user, {
    type: "TEMPLATE",
    content: data.preview || data.templateName,
    body: data.preview || null,
    templateName: data.templateName,
    whatsappMessageId: data.whatsappMessageId || null,
    status: "SENT",
    rawPayload: {
      templateName: data.templateName,
      languageCode: data.languageCode,
      components: data.components || [],
      parameters: data.parameters || [],
      templateId: data.templateId || null,
      metaResponse: data.metaResponse || null,
      sentAt: new Date().toISOString()
    }
  });
}

async function downloadMissingMedia(messageId) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
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

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  if (!message.mediaId) {
    throw new ApiError(400, "Message does not have a WhatsApp media id");
  }

  if (message.mediaUrl) {
    logger.debugStep("Message media already downloaded", {
      messageId: message.id,
      type: message.type,
      mediaId: message.mediaId,
      mediaUrl: message.mediaUrl
    });

    return { message, downloaded: false, alreadyDownloaded: true };
  }

  if (!["IMAGE", "VIDEO", "AUDIO", "VOICE", "DOCUMENT", "STICKER"].includes(message.type)) {
    throw new ApiError(400, "Message type is not downloadable media");
  }

  const downloaded = await mediaService.downloadInboundMedia({
    messageType: message.type,
    mediaId: message.mediaId,
    mimeType: message.mimeType,
    caption: message.caption,
    fileName: message.fileName,
    fileSize: message.fileSize,
    duration: message.duration
  });

  if (!downloaded || !downloaded.mediaUrl) {
    throw new ApiError(502, "Could not download WhatsApp media for this message");
  }

  const updated = await prisma.message.update({
    where: { id: message.id },
    data: {
      mediaUrl: downloaded.mediaUrl,
      mimeType: downloaded.mimeType || message.mimeType,
      fileName: downloaded.fileName || message.fileName,
      fileSize: downloaded.fileSize || message.fileSize,
      caption: downloaded.caption || message.caption,
      duration: downloaded.duration || message.duration,
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

  logger.debugStep("Downloaded missing message media", {
    messageId: updated.id,
    type: updated.type,
    mediaId: updated.mediaId,
    mediaUrl: updated.mediaUrl,
    mimeType: updated.mimeType,
    fileSize: updated.fileSize
  });

  notifyMessageStatus(updated);

  return { message: updated, downloaded: true, alreadyDownloaded: false };
}

function parseRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());

  if (!match) {
    return null;
  }

  const rawStart = match[1];
  const rawEnd = match[2];

  if (!rawStart && !rawEnd) {
    return null;
  }

  let start = rawStart ? Number(rawStart) : 0;
  let end = rawEnd ? Number(rawEnd) : fileSize - 1;

  if (!rawStart && rawEnd) {
    const suffixLength = Number(rawEnd);
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return { invalid: true };
  }

  return {
    start,
    end: Math.min(end, fileSize - 1)
  };
}

async function getMessageMediaStream(messageId, user, rangeHeader) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      customerId: true,
      type: true,
      mediaUrl: true,
      mediaId: true,
      mimeType: true,
      fileName: true
    }
  });

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  await getCustomerForUser(message.customerId, user);

  if (!message.mediaUrl) {
    throw new ApiError(404, "Media is not available yet");
  }

  const localPath = pathFromMediaUrl(message.mediaUrl);

  if (!localPath) {
    throw new ApiError(404, "Media file is not available");
  }

  let stat;

  try {
    stat = await fs.promises.stat(localPath);
  } catch (error) {
    throw new ApiError(404, "Media file is not available");
  }

  if (!stat.isFile()) {
    throw new ApiError(404, "Media file is not available");
  }

  const mimeType = message.mimeType || "application/octet-stream";
  const range = parseRangeHeader(rangeHeader, stat.size);

  if (range && range.invalid) {
    return {
      statusCode: 416,
      headers: {
        "Content-Range": `bytes */${stat.size}`,
        "Accept-Ranges": "bytes"
      },
      stream: null
    };
  }

  const fileName = message.fileName || `${message.id}`;

  if (range) {
    return {
      statusCode: 206,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": range.end - range.start + 1,
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Disposition": `inline; filename="${String(fileName).replace(/"/g, "")}"`
      },
      stream: fs.createReadStream(localPath, { start: range.start, end: range.end })
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${String(fileName).replace(/"/g, "")}"`
    },
    stream: fs.createReadStream(localPath)
  };
}

function normalizeCampaignSelectionMode(value) {
  return value === "all_matching" ? "all_matching" : "explicit";
}

function uniqueCustomerIds(ids = []) {
  return [...new Set((ids || []).filter(Boolean))];
}

function selectedDebtIds(data = {}) {
  return [...new Set([...(data.debtIds || []), ...(data.recipients || []).map((item) => item.debtId)].filter(Boolean))];
}

function excludedDebtIds(data = {}) {
  return [...new Set((data.excludedDebtIds || []).filter(Boolean))];
}

function excludedCustomerIds(data) {
  return uniqueCustomerIds(data.excludedCustomerIds || []);
}

async function loadApprovedCampaignTemplate(data) {
  const where = data.templateId
    ? { id: data.templateId }
    : {
        name: data.templateName,
        language: data.languageCode
      };
  const template = data.templateId
    ? await prisma.whatsappTemplate.findUnique({ where })
    : await prisma.whatsappTemplate.findFirst({ where });

  if (!template || template.status !== "APPROVED" || template.isActive === false) {
    throw new ApiError(400, "هذا القالب غير معتمد أو تم تعطيله.");
  }

  return template;
}

async function loadTemplateMappingStatus(template) {
  const rows = await prisma.whatsappTemplateVariableMapping.findMany({
    where: {
      templateId: template.id,
      language: template.language
    }
  });

  return buildMappingStatus(template, rows);
}

function assertTemplateMappingComplete(status) {
  if (!status.isComplete) {
    throw new ApiError(400, status.message || "أكمل ربط متغيرات هذا القالب قبل تجهيز الحملة.", status.missingVariables);
  }
}

function campaignCustomerWhere(user, data) {
  if (data && data.accessWhere) {
    return data.accessWhere;
  }

  const selectionMode = normalizeCampaignSelectionMode(data.selectionMode);

  if (selectionMode === "all_matching") {
    const where = buildCustomerWhere(user, data.filters || {});
    const excluded = excludedCustomerIds(data);

    if (excluded.length > 0) {
      where.id = { notIn: excluded };
    }

    return where;
  }

  const recipientCustomerIds = (data.recipients || []).map((item) => item.customerId);
  const ids = uniqueCustomerIds([...(data.customerIds || []), ...recipientCustomerIds]);
  const debts = selectedDebtIds(data);

  return {
    ...buildCustomerWhere(user, data.filters || {}),
    ...(ids.length ? { id: { in: ids } } : {}),
    ...(debts.length ? { debts: { some: { id: { in: debts } } } } : {})
  };
}

function customerDisplayName(customer) {
  return customer.fullName || customer.name || customer.whatsappProfileName || customer.phone;
}

function getCampaignPhone(customer) {
  const primary = Array.isArray(customer.phones)
    ? customer.phones.find((phone) => phone.isPrimary) || customer.phones[0]
    : null;

  return primary ? primary.phoneNumber : customer.phone;
}

function invalidPhoneReason(customer) {
  const phone = safeNormalizePhone(getCampaignPhone(customer));

  if (!phone || phone.length < 6) {
    return "رقم الهاتف غير صالح";
  }

  return null;
}

function evaluateCampaignRecipient(template, mappings, customer, debt) {
  const formattedCustomer = formatCustomer(customer);
  const reasons = [];
  const phoneReason = invalidPhoneReason(customer);

  if (phoneReason) {
    reasons.push(phoneReason);
  }

  if (!debt || debt.isActive === false) {
    reasons.push("المديونية مغلقة");
  }

  const resolved = resolveTemplateForCustomer(template, mappings, formattedCustomer, debt);

  for (const missing of resolved.missing) {
    reasons.push(missing.reason);
  }

  const components = buildTemplateComponents(template, resolved.valuesByKey);
  const renderedTemplate = buildTemplatePreview(template, resolved.valuesByKey) || template.name;

  return {
    customer: formattedCustomer,
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    resolvedVariables: resolved.resolvedVariables,
    components,
    renderedTemplate,
    snapshot: {
      customer: sanitizeCustomerSnapshot(formattedCustomer, debt),
      debt: debt ? sanitizeCustomerSnapshot(formattedCustomer, debt) : null,
      template: {
        id: template.id,
        name: template.name,
        language: template.language,
        category: template.category
      },
      resolvedVariables: resolved.resolvedVariables,
      renderedTemplate
    }
  };
}

async function countSelectedCampaignCustomers(user, data) {
  const selectionMode = normalizeCampaignSelectionMode(data.selectionMode);
  const excluded = new Set(excludedCustomerIds(data));

  if (selectionMode === "explicit") {
    const debtIds = selectedDebtIds(data).filter((id) => !new Set(excludedDebtIds(data)).has(id));
    if (debtIds.length) return prisma.customerDebt.count({ where: { id: { in: debtIds }, customer: { is: campaignCustomerWhere(user, data) } } });
    return prisma.customerDebt.count({ where: { customerId: { in: uniqueCustomerIds(data.customerIds).filter((id) => !excluded.has(id)) }, isActive: true } });
  }

  return prisma.customerDebt.count({ where: { customer: { is: campaignCustomerWhere(user, data) }, isActive: true, id: { notIn: excludedDebtIds(data) } } });
}

async function previewBulkTemplate(user, data) {
  const template = await loadApprovedCampaignTemplate(data);
  const mappingStatus = await loadTemplateMappingStatus(template);
  const selectedCount = await countSelectedCampaignCustomers(user, data);
  const previewLimit = Math.min(Math.max(Number(data.limit || 3), 1), 5);
  const previewItems = [];
  const excludedCustomers = [];
  let eligibleRecipients = 0;
  let invalidPhoneNumbers = 0;

  if (selectedCount > 0) {
    const customerIterable = normalizeCampaignSelectionMode(data.selectionMode) === "all_matching"
      ? iterateAllMatchingCampaignCustomers(user, data)
      : await loadExplicitCampaignCustomers(user, data);

    for await (const customer of customerIterable) {
      const allowedDebtIds = new Set(selectedDebtIds(data));
      const debts = (customer.debts || []).filter((debt) => debt.isActive && !excludedDebtIds(data).includes(debt.id) && (!allowedDebtIds.size || allowedDebtIds.has(debt.id)));
      for (const debt of debts) {
      const evaluated = evaluateCampaignRecipient(template, mappingStatus.mappings, customer, debt);
      const eligible = mappingStatus.isComplete && evaluated.eligible;

      if (eligible) {
        eligibleRecipients += 1;
      } else {
        if (evaluated.reasons.includes("رقم الهاتف غير صالح")) {
          invalidPhoneNumbers += 1;
        }

        excludedCustomers.push({
          customerId: evaluated.customer.id,
          debtId: debt.id,
          fullName: customerDisplayName(evaluated.customer),
          reason: mappingStatus.isComplete
            ? evaluated.reasons.join("، ")
            : mappingStatus.message
        });
      }

      if (previewItems.length < previewLimit) {
        previewItems.push({
          customerId: evaluated.customer.id,
          debtId: debt.id,
          customerName: customerDisplayName(evaluated.customer),
          phone: evaluated.customer.primaryPhone || evaluated.customer.phone,
          eligible,
          warnings: eligible ? [] : (mappingStatus.isComplete ? evaluated.reasons : [mappingStatus.message].filter(Boolean)),
          resolvedVariables: evaluated.resolvedVariables,
          renderedTemplate: evaluated.renderedTemplate
        });
      }
      }
    }
  }

  return {
    template: {
      id: template.id,
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status
    },
    selectionMode: normalizeCampaignSelectionMode(data.selectionMode),
    totalSelected: selectedCount,
    eligibleRecipients,
    skippedCustomers: excludedCustomers.length,
    invalidPhoneNumbers,
    estimatedSendCount: eligibleRecipients,
    excludedCustomers,
    mapping: {
      isComplete: mappingStatus.isComplete,
      message: mappingStatus.message,
      variables: mappingStatus.variables,
      mappings: mappingStatus.mappings,
      missingVariables: mappingStatus.missingVariables
    },
    previews: previewItems
  };
}

async function loadExplicitCampaignCustomers(user, data) {
  const ids = uniqueCustomerIds(data.customerIds);

  if (ids.length === 0) {
    return [];
  }

  const customers = await prisma.customer.findMany({
    where: campaignCustomerWhere(user, data),
    include: customerInclude()
  });

  if (customers.length !== ids.length) {
    throw new ApiError(403, "One or more customers are not accessible");
  }

  return customers;
}

async function* iterateAllMatchingCampaignCustomers(user, data) {
  const where = campaignCustomerWhere(user, data);
  const take = Number(data.batchSize || env.CAMPAIGN_PREPARE_BATCH_SIZE || 250);
  let cursor = null;

  while (true) {
    const customers = await prisma.customer.findMany({
      where,
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [
        { createdAt: "desc" },
        { id: "asc" }
      ],
      include: customerInclude()
    });

    if (customers.length === 0) {
      return;
    }

    for (const customer of customers) {
      yield customer;
    }

    cursor = customers[customers.length - 1].id;
  }
}

async function* iterateExplicitCampaignCustomerChunks(user, data) {
  const excluded = new Set(excludedCustomerIds(data));
  const ids = uniqueCustomerIds(data.customerIds).filter((id) => !excluded.has(id));
  const batchSize = Number(data.batchSize || env.CAMPAIGN_PREPARE_BATCH_SIZE || 250);
  const baseWhere = data.accessWhere || buildCustomerWhere(user, data.filters || {});

  for (let index = 0; index < ids.length; index += batchSize) {
    const chunkIds = ids.slice(index, index + batchSize);
    const customers = await prisma.customer.findMany({
      where: {
        ...baseWhere,
        id: { in: chunkIds }
      },
      include: customerInclude()
    });

    if (customers.length !== chunkIds.length) {
      throw new ApiError(403, "One or more customers are not accessible");
    }

    yield customers;
  }
}

async function* iterateAllMatchingCampaignCustomerChunks(user, data) {
  const iterator = iterateAllMatchingCampaignCustomers(user, data);
  const batchSize = Number(data.batchSize || env.CAMPAIGN_PREPARE_BATCH_SIZE || 250);
  let batch = [];

  for await (const customer of iterator) {
    batch.push(customer);

    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }

  if (batch.length > 0) {
    yield batch;
  }
}

function campaignPayloadFromData(user, data, template) {
  return {
    templateId: template.id,
    templateName: template.name,
    languageCode: template.language,
    selectionMode: normalizeCampaignSelectionMode(data.selectionMode),
    customerIds: normalizeCampaignSelectionMode(data.selectionMode) === "explicit" ? uniqueCustomerIds(data.customerIds) : [],
    recipients: normalizeCampaignSelectionMode(data.selectionMode) === "explicit" ? (data.recipients || []) : [],
    debtIds: normalizeCampaignSelectionMode(data.selectionMode) === "explicit" ? selectedDebtIds(data) : [],
    excludedCustomerIds: excludedCustomerIds(data),
    excludedDebtIds: excludedDebtIds(data),
    filters: data.filters || {},
    accessWhere: campaignCustomerWhere(user, data)
  };
}

function formatCampaign(campaign) {
  const progressPercentage = campaign.eligibleCount > 0
    ? Math.min(100, Math.round(((campaign.sentCount + campaign.deliveredCount + campaign.readCount + campaign.failedCount) / campaign.eligibleCount) * 100))
    : campaign.status === "COMPLETED" || campaign.status === "COMPLETED_WITH_ERRORS" ? 100 : 0;

  return {
    campaignId: campaign.id,
    id: campaign.id,
    status: campaign.status,
    templateId: campaign.templateId,
    templateName: campaign.templateName,
    languageCode: campaign.languageCode,
    selectionMode: campaign.selectionMode,
    recipientCount: campaign.selectedCount,
    selected: campaign.selectedCount,
    eligible: campaign.eligibleCount,
    queued: campaign.queuedCount,
    sent: campaign.sentCount,
    delivered: campaign.deliveredCount,
    read: campaign.readCount,
    failed: campaign.failedCount,
    skipped: campaign.skippedCount,
    pending: campaign.pendingCount,
    progressPercentage,
    error: campaign.error || null,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    startedAt: campaign.startedAt,
    preparedAt: campaign.preparedAt,
    completedAt: campaign.completedAt
  };
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
  const pendingCount = queuedCount;
  const processedCount = sentCount + deliveredCount + readCount + failedCount;
  let status = campaign.status;
  let completedAt = campaign.completedAt;

  if (["RUNNING", "QUEUED", "READY"].includes(status) && campaign.eligibleCount > 0 && processedCount >= campaign.eligibleCount) {
    status = failedCount > 0 || campaign.skippedCount > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
    completedAt = completedAt || new Date();
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status,
      queuedCount,
      sentCount,
      deliveredCount,
      readCount,
      failedCount,
      pendingCount,
      completedAt
    }
  });

  return formatCampaign(updated);
}

async function getCampaignProgress(user, campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }
  });

  if (!campaign) {
    throw new ApiError(404, "Campaign not found");
  }

  if (user.role !== "ADMIN" && campaign.createdById !== user.id) {
    throw new ApiError(404, "Campaign not found");
  }

  return refreshCampaignProgress(campaign.id);
}

async function createCampaignMessages(rows) {
  if (rows.length === 0) {
    return [];
  }

  if (typeof prisma.message.createManyAndReturn === "function") {
    return prisma.message.createManyAndReturn({ data: rows });
  }

  const created = [];

  for (const row of rows) {
    created.push(await prisma.message.create({ data: row }));
  }

  return created;
}

async function enqueueCampaignMessages(campaignId, messages) {
  let enqueued = 0;
  let failed = 0;

  for (const message of messages) {
    try {
      await enqueueOutboundMessage(message.id);
      enqueued += 1;
    } catch (error) {
      failed += 1;
      logger.error({
        err: error,
        campaignId,
        messageId: message.id,
        customerId: message.customerId,
        queue: WHATSAPP_OUTBOUND_QUEUE
      }, "Failed to enqueue campaign recipient message");

      await markOutboundEnqueueFailed(message.id, error);
    }
  }

  return { enqueued, failed };
}

async function prepareCampaignCustomerBatch({ campaign, template, mappings, customers }) {
  const now = new Date();
  const messageRows = [];
  const skipped = [];

  const payload = campaign.rawPayload || {};
  const allowedDebtIds = new Set(selectedDebtIds(payload));
  for (const customer of customers) {
    const debts = (customer.debts || []).filter((debt) => debt.isActive && !excludedDebtIds(payload).includes(debt.id) && (!allowedDebtIds.size || allowedDebtIds.has(debt.id)));
    for (const debt of debts) {
    const evaluated = evaluateCampaignRecipient(template, mappings, customer, debt);

    if (!evaluated.eligible) {
      skipped.push({
        customerId: evaluated.customer.id,
        debtId: debt.id,
        reason: evaluated.reasons.join("، ")
      });
      continue;
    }

    messageRows.push({
      customerId: customer.id,
      debtId: debt.id,
      campaignId: campaign.id,
      direction: "OUTBOUND",
      type: "TEMPLATE",
      content: evaluated.renderedTemplate,
      body: evaluated.renderedTemplate,
      templateName: template.name,
      status: "QUEUED",
      sentByUserId: campaign.createdById || null,
      rawPayload: {
        templateId: template.id,
        templateName: template.name,
        languageCode: template.language,
        category: template.category,
        selectionMode: campaign.selectionMode,
        components: evaluated.components,
        recipientSnapshot: evaluated.snapshot,
        queuedAt: now.toISOString()
      },
      statusUpdatedAt: now
    });
    }
  }

  const messages = await createCampaignMessages(messageRows);
  for (const message of messages) {
    const snapshot = message.rawPayload && message.rawPayload.recipientSnapshot;
    const debtSnapshot = snapshot && snapshot.debt;
    if (!message.debtId || !debtSnapshot) continue;
    await prisma.campaignRecipient.upsert({
      where: { campaignId_debtId: { campaignId: campaign.id, debtId: message.debtId } },
      update: { messageId: message.id, sendStatus: message.status },
      create: {
        campaignId: campaign.id,
        customerId: message.customerId,
        debtId: message.debtId,
        phoneSnapshot: snapshot.customer.phone || null,
        projectSnapshot: debtSnapshot.projectName || null,
        accountNumberSnapshot: debtSnapshot.accountNumber || null,
        serviceNumberSnapshot: debtSnapshot.serviceNumber || null,
        debtYearSnapshot: debtSnapshot.debtYear || null,
        debtAmountSnapshot: debtSnapshot.debtAmount || null,
        resolvedTemplateParameters: snapshot.resolvedVariables || [],
        eligible: true,
        sendStatus: message.status,
        messageId: message.id
      }
    });
  }
  const enqueueResult = await enqueueCampaignMessages(campaign.id, messages);

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      eligibleCount: { increment: messages.length },
      queuedCount: { increment: enqueueResult.enqueued },
      failedCount: { increment: enqueueResult.failed },
      skippedCount: { increment: skipped.length },
      pendingCount: { increment: enqueueResult.enqueued }
    }
  });

  return {
    eligible: messages.length,
    skipped: skipped.length,
    enqueueFailed: enqueueResult.failed
  };
}

async function processCampaignPreparation(campaignId) {
  const existing = await prisma.campaign.findUnique({
    where: { id: campaignId }
  });

  if (!existing) {
    throw new ApiError(404, "Campaign not found");
  }

  if (!["QUEUED", "PREPARING"].includes(existing.status)) {
    return formatCampaign(existing);
  }

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "PREPARING",
      startedAt: existing.startedAt || new Date(),
      error: null
    }
  });
  const payload = campaign.rawPayload || {};

  try {
    const template = await loadApprovedCampaignTemplate({
      templateId: campaign.templateId,
      templateName: campaign.templateName,
      languageCode: campaign.languageCode
    });
    const mappingStatus = await loadTemplateMappingStatus(template);
    assertTemplateMappingComplete(mappingStatus);

    const backgroundScope = { id: campaign.createdById, role: "ADMIN" };
    const iterator = campaign.selectionMode === "all_matching"
      ? iterateAllMatchingCampaignCustomerChunks(backgroundScope, payload)
      : iterateExplicitCampaignCustomerChunks(backgroundScope, payload);

    for await (const customers of iterator) {
      await prepareCampaignCustomerBatch({
        campaign,
        template,
        mappings: mappingStatus.mappings,
        customers
      });
    }

    const refreshed = await refreshCampaignProgress(campaign.id);
    const processedCount = refreshed.sent + refreshed.delivered + refreshed.read + refreshed.failed;
    const finalStatus = refreshed.eligible === 0
      ? "COMPLETED_WITH_ERRORS"
      : processedCount >= refreshed.eligible
        ? refreshed.failed > 0 || refreshed.skipped > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED"
        : "RUNNING";

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: finalStatus,
        preparedAt: new Date(),
        completedAt: terminalCampaignStatuses.has(finalStatus) ? new Date() : null
      }
    });

    return formatCampaign(updated);
  } catch (error) {
    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "FAILED",
        error: error && error.message ? error.message : "Campaign preparation failed",
        completedAt: new Date()
      }
    });

    logger.error({ err: error, campaignId }, "Campaign preparation failed");
    return formatCampaign(updated);
  }
}

async function sendBulkTemplate(user, data) {
  const selectionMode = normalizeCampaignSelectionMode(data.selectionMode);
  const template = await loadApprovedCampaignTemplate(data);
  const mappingStatus = await loadTemplateMappingStatus(template);
  const totalSelected = await countSelectedCampaignCustomers(user, data);
  const idempotencyKey = data.idempotencyKey || null;

  assertTemplateMappingComplete(mappingStatus);

  if (totalSelected === 0) {
    throw new ApiError(400, "اختر عميلًا واحدًا على الأقل");
  }

  if (idempotencyKey) {
    const existing = await prisma.campaign.findUnique({
      where: { idempotencyKey }
    });

    if (existing) {
      if (existing.status === "FAILED" && String(existing.error || "").startsWith("Queue enqueue failed:")) {
        throw new ApiError(503, "تعذر إضافة الحملة إلى قائمة التجهيز، برجاء المحاولة مرة أخرى", [{
          campaignId: existing.id,
          queue: CAMPAIGN_PREPARE_QUEUE
        }]);
      }

      return formatCampaign(existing);
    }
  }

  const payload = campaignPayloadFromData(user, data, template);
  let campaign;

  try {
    campaign = await prisma.campaign.create({
      data: {
        idempotencyKey,
        templateId: template.id,
        templateName: template.name,
        languageCode: template.language,
        selectionMode,
        filters: payload.filters,
        excludedCustomerIds: payload.excludedCustomerIds,
        excludedDebtIds: payload.excludedDebtIds,
        status: "QUEUED",
        selectedCount: totalSelected,
        pendingCount: 0,
        rawPayload: payload,
        createdById: user.id
      }
    });
  } catch (error) {
    if (idempotencyKey && error.code === "P2002") {
      const existing = await prisma.campaign.findUnique({
        where: { idempotencyKey }
      });

      if (existing) {
        if (existing.status === "FAILED" && String(existing.error || "").startsWith("Queue enqueue failed:")) {
          throw new ApiError(503, "تعذر إضافة الحملة إلى قائمة التجهيز، برجاء المحاولة مرة أخرى", [{
            campaignId: existing.id,
            queue: CAMPAIGN_PREPARE_QUEUE
          }]);
        }

        return formatCampaign(existing);
      }
    }

    throw error;
  }

  try {
    await enqueueCampaignPreparation(campaign.id);
  } catch (error) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "FAILED",
        error: `Queue enqueue failed: ${getQueueErrorMessage(error)}`,
        completedAt: new Date()
      }
    }).catch((updateError) => {
      logger.error({ err: updateError, campaignId: campaign.id }, "Failed to mark campaign enqueue failure");
    });

    logger.error({ err: error, campaignId: campaign.id, queue: CAMPAIGN_PREPARE_QUEUE }, "Failed to queue campaign preparation");
    throw new ApiError(503, "تعذر إضافة الحملة إلى قائمة التجهيز، برجاء المحاولة مرة أخرى", [{
      campaignId: campaign.id,
      queue: CAMPAIGN_PREPARE_QUEUE,
      queueError: env.NODE_ENV === "production" ? undefined : getQueueErrorMessage(error)
    }]);
  }

  return {
    ...formatCampaign(campaign),
    recipientCount: totalSelected,
    message: "تمت إضافة الحملة إلى قائمة الإرسال"
  };
}

module.exports = {
  getInbox,
  listMessages,
  markConversationRead,
  sendManualReply,
  quickSend,
  sendManualMedia,
  recordSentTemplateMessage,
  downloadMissingMedia,
  getMessageMediaStream,
  previewBulkTemplate,
  getCampaignProgress,
  refreshCampaignProgress,
  processCampaignPreparation,
  sendBulkTemplate
};
