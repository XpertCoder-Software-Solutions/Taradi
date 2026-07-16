const prisma = require("../config/prisma");
const logger = require("../config/logger");
const ApiError = require("../utils/apiError");
const getPagination = require("../utils/pagination");
const { safeNormalizePhone } = require("../utils/normalizePhone");
const { friendlyWhatsAppFailureMessage } = require("../utils/whatsappErrors");
const { hasPermission } = require("./permission.service");
const { safeRecordEmployeeActivity } = require("./employeeActivity.service");

const blockedCollectionStatuses = ["PAID", "DO_NOT_CONTACT"];
const collectionStatusLabels = {
  ACTIVE_DEBT: "مديونية قائمة",
  PAID: "تم السداد",
  PARTIALLY_PAID: "سداد جزئي",
  PROMISED_TO_PAY: "وعد بالسداد",
  DISPUTED: "متنازع عليها",
  DO_NOT_CONTACT: "ممنوع التواصل"
};

const userSummarySelect = {
  id: true,
  email: true,
  employeeCode: true,
  name: true,
  role: true,
  supervisorId: true,
  isActive: true
};

const validStatuses = ["OPEN", "PENDING", "CLOSED", "ARCHIVED"];
const validPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];

function conversationInclude() {
  return {
    customer: {
      include: {
        phones: {
          orderBy: [
            { isPrimary: "desc" },
            { position: "asc" },
            { createdAt: "asc" }
          ]
        }
      }
    },
    assignedEmployee: {
      select: userSummarySelect
    },
    lastMessage: {
      include: {
        sentByUser: {
          select: userSummarySelect
        }
      }
    }
  };
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function normalizeStatus(value) {
  if (!value) {
    return null;
  }

  const status = String(value).toUpperCase();
  return validStatuses.includes(status) ? status : null;
}

function normalizePriority(value) {
  if (!value) {
    return null;
  }

  const priority = String(value).toUpperCase();
  return validPriorities.includes(priority) ? priority : null;
}

function formatMessageSummary(message) {
  if (!message) {
    return null;
  }

  return {
    id: message.id,
    customerId: message.customerId,
    conversationId: message.conversationId,
    direction: message.direction,
    type: message.type,
    body: message.body || message.content,
    content: message.content,
    mediaUrl: message.mediaUrl,
    mediaId: message.mediaId,
    mimeType: message.mimeType,
    fileName: message.fileName,
    fileSize: message.fileSize,
    caption: message.caption,
    duration: message.duration,
    templateName: message.templateName,
    whatsappMessageId: message.whatsappMessageId,
    status: message.status,
    statusUpdatedAt: message.statusUpdatedAt,
    sentByUserId: message.sentByUserId,
    sentByUser: message.sentByUser || null,
    error: friendlyWhatsAppFailureMessage(message.error, message.error),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt
  };
}

function formatConversation(conversation) {
  const primaryPhone = conversation.customer && Array.isArray(conversation.customer.phones)
    ? (conversation.customer.phones.find((phone) => phone.isPrimary) || conversation.customer.phones[0])
    : null;

  return {
    id: conversation.id,
    customerId: conversation.customerId,
    customer: conversation.customer
      ? {
          id: conversation.customer.id,
          name: conversation.customer.fullName || conversation.customer.name,
          fullName: conversation.customer.fullName || conversation.customer.name,
          phone: primaryPhone ? primaryPhone.phoneNumber : conversation.customer.phone,
          primaryPhone: primaryPhone ? primaryPhone.phoneNumber : conversation.customer.phone,
          accountNumber: conversation.customer.accountNumber,
          projectName: conversation.customer.projectName,
          collectionStatus: conversation.customer.collectionStatus || "ACTIVE_DEBT",
          collectionStatusLabel: collectionStatusLabels[conversation.customer.collectionStatus] || "مديونية قائمة",
          contactBlocked: blockedCollectionStatuses.includes(conversation.customer.collectionStatus),
          whatsappProfileName: conversation.customer.whatsappProfileName,
          source: conversation.customer.source || "MANUAL"
        }
      : null,
    assignedEmployeeId: conversation.assignedEmployeeId,
    assignedEmployee: conversation.assignedEmployee || null,
    lastMessage: formatMessageSummary(conversation.lastMessage),
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: conversation.unreadCount,
    status: conversation.status,
    priority: conversation.priority,
    tags: conversation.tags || [],
    archivedAt: conversation.archivedAt,
    archivedById: conversation.archivedById || null,
    archiveReason: conversation.archiveReason || null,
    previousAssigneeId: conversation.previousAssigneeId || null,
    reassignedToId: conversation.reassignedToId || null,
    reassignedAt: conversation.reassignedAt || null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
}

async function getCustomerAssignment(customerId, db = prisma) {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      assignedToId: true,
      tags: true
    }
  });

  if (!customer) {
    throw new ApiError(404, "Customer not found or not accessible");
  }

  return customer;
}

async function ensureConversationForCustomer(customerId, options = {}) {
  const db = options.tx || prisma;
  const customer = options.customer || await getCustomerAssignment(customerId, db);
  const assignedEmployeeId = Object.prototype.hasOwnProperty.call(options, "assignedEmployeeId")
    ? options.assignedEmployeeId
    : customer.assignedToId;

  const data = {
    assignedEmployeeId: assignedEmployeeId || null
  };

  if (options.tags) {
    data.tags = options.tags;
  }

  return db.conversation.upsert({
    where: { activeKey: customerId },
    update: data,
    create: {
      customerId,
      activeKey: customerId,
      assignedEmployeeId: assignedEmployeeId || null,
      status: options.status || "OPEN",
      tags: options.tags || customer.tags || []
    },
    ...(options.include ? { include: options.include } : {})
  });
}

async function syncConversationAssignment(customerId, employeeId) {
  return ensureConversationForCustomer(customerId, {
    assignedEmployeeId: employeeId || null,
    include: conversationInclude()
  });
}

function assertConversationVisibleToUser(conversation, user) {
  if (user.role === "ADMIN") {
    return;
  }

  const visibleIds = scopedConversationAssigneeIds(user);

  if (!conversation.assignedEmployeeId || !visibleIds.includes(conversation.assignedEmployeeId)) {
    throw new ApiError(404, "Conversation not found or not accessible");
  }
}

async function getConversationForUserByCustomerId(customerId, user) {
  const conversation = await ensureConversationForCustomer(customerId, {
    include: conversationInclude()
  });

  assertConversationVisibleToUser(conversation, user);

  return conversation;
}

async function getConversationForUser(customerId, user, options = {}) {
  if (!options.conversationId) {
    return getConversationForUserByCustomerId(customerId, user);
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: options.conversationId,
      customerId
    },
    include: conversationInclude()
  });

  if (!conversation) {
    throw new ApiError(404, "Conversation not found or not accessible");
  }

  assertConversationVisibleToUser(conversation, user);
  return conversation;
}

function scopedConversationAssigneeIds(user) {
  if (user.role === "ADMIN") {
    return null;
  }

  if (user.role === "SUPERVISOR" && hasPermission(user, "chats.view_team")) {
    return [user.id, ...(user.teamMemberIds || [])];
  }

  return [user.id];
}

function conversationAccessWhere(user) {
  const assigneeIds = scopedConversationAssigneeIds(user);

  if (!assigneeIds) {
    return {};
  }

  return { assignedEmployeeId: { in: assigneeIds } };
}

async function touchConversationForMessage({ customerId, messageId, messageAt, direction }) {
  const conversation = await ensureConversationForCustomer(customerId);
  const data = {
    lastMessageId: messageId,
    lastMessageAt: messageAt || new Date()
  };

  if (direction === "INBOUND") {
    data.status = "OPEN";
    data.unreadCount = { increment: 1 };
  }

  return prisma.conversation.update({
    where: { id: conversation.id },
    data,
    include: conversationInclude()
  });
}

function buildArchivedConversationSystemMessage({ previousAssigneeName, newAssigneeName, actorName, reassignedAt }) {
  const date = new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(reassignedAt);

  return `تم نقل العميل من ${previousAssigneeName || "غير مسند"} إلى ${newAssigneeName || "غير مسند"} بواسطة ${actorName || "النظام"} في ${date}.`;
}

function buildNewConversationSystemMessage({ newAssigneeName, actorName, reassignedAt }) {
  const date = new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(reassignedAt);

  return `تم إسناد العميل إلى ${newAssigneeName || "غير مسند"} بواسطة ${actorName || "النظام"} في ${date}.`;
}

async function createSystemMessage(tx, { customerId, conversationId, body, actorId, createdAt }) {
  const message = await tx.message.create({
    data: {
      customerId,
      conversationId,
      direction: "OUTBOUND",
      type: "SYSTEM",
      content: body,
      body,
      status: "SENT",
      sentByUserId: actorId || null,
      statusUpdatedAt: createdAt,
      createdAt
    }
  });

  await tx.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageId: message.id,
      lastMessageAt: createdAt
    }
  });

  return message;
}

async function reassignCustomerConversationInTransaction(tx, {
  customerId,
  newAssigneeId,
  actor,
  reason = null,
  preloadedCustomer = null,
  newAssignee = null
}) {
  const now = new Date();
  const actorId = actor && actor.id ? actor.id : null;
  const actorName = actor && actor.name ? actor.name : "النظام";
  const customer = preloadedCustomer || await tx.customer.findUnique({
    where: { id: customerId },
    include: {
      assignedTo: { select: userSummarySelect }
    }
  });

  if (!customer) {
    throw new ApiError(404, "Customer not found or not accessible");
  }

  const currentAssigneeId = customer.assignedToId || null;

  if (currentAssigneeId === (newAssigneeId || null)) {
    const activeConversation = await ensureConversationForCustomer(customerId, {
      tx,
      customer,
      assignedEmployeeId: newAssigneeId || null,
      include: conversationInclude()
    });

    return {
      customerId,
      previousAssigneeId: currentAssigneeId,
      newAssigneeId: newAssigneeId || null,
      archivedConversationId: null,
      activeConversationId: activeConversation.id,
      reassignedAt: now,
      sameAssignment: true
    };
  }

  const activeConversations = await tx.conversation.findMany({
    where: {
      customerId,
      activeKey: customerId
    },
    include: {
      assignedEmployee: { select: userSummarySelect }
    }
  });

  if (activeConversations.length > 1) {
    logger.warn({
      customerId,
      activeConversationIds: activeConversations.map((conversation) => conversation.id)
    }, "Customer has multiple active conversations; refusing reassignment");
    throw new ApiError(409, "يوجد أكثر من محادثة نشطة لهذا العميل، يرجى مراجعة الدعم قبل إعادة الإسناد");
  }

  const activeConversation = activeConversations[0] || null;
  const previousAssigneeId = activeConversation && activeConversation.assignedEmployeeId
    ? activeConversation.assignedEmployeeId
    : currentAssigneeId;
  const previousAssigneeName = activeConversation && activeConversation.assignedEmployee
    ? activeConversation.assignedEmployee.name
    : customer.assignedTo ? customer.assignedTo.name : null;
  const newAssigneeName = newAssignee && newAssignee.name ? newAssignee.name : null;
  let archivedConversationId = null;

  if (activeConversation) {
    await tx.conversation.update({
      where: { id: activeConversation.id },
      data: {
        activeKey: null,
        status: "ARCHIVED",
        archivedAt: now,
        archivedById: actorId,
        archiveReason: reason,
        previousAssigneeId,
        reassignedToId: newAssigneeId || null,
        reassignedAt: now,
        unreadCount: 0
      }
    });
    archivedConversationId = activeConversation.id;

    await createSystemMessage(tx, {
      customerId,
      conversationId: activeConversation.id,
      body: buildArchivedConversationSystemMessage({
        previousAssigneeName,
        newAssigneeName,
        actorName,
        reassignedAt: now
      }),
      actorId,
      createdAt: now
    });
  }

  const newActiveConversation = await tx.conversation.create({
    data: {
      customerId,
      activeKey: customerId,
      assignedEmployeeId: newAssigneeId || null,
      status: "OPEN",
      unreadCount: 0,
      tags: customer.tags || [],
      lastMessageAt: now
    }
  });

  await createSystemMessage(tx, {
    customerId,
    conversationId: newActiveConversation.id,
    body: buildNewConversationSystemMessage({
      newAssigneeName,
      actorName,
      reassignedAt: now
    }),
    actorId,
    createdAt: now
  });

  await tx.customer.update({
    where: { id: customerId },
    data: { assignedToId: newAssigneeId || null }
  });

  await tx.conversationAssignmentHistory.create({
    data: {
      customerId,
      archivedConversationId,
      activeConversationId: newActiveConversation.id,
      previousAssigneeId,
      newAssigneeId: newAssigneeId || null,
      reassignedById: actorId,
      reason
    }
  });

  logger.info({
    actorId,
    customerId,
    previousAssigneeId,
    newAssigneeId: newAssigneeId || null,
    archivedConversationId,
    activeConversationId: newActiveConversation.id,
    reason
  }, "Customer reassigned and previous conversation archived");

  return {
    customerId,
    previousAssigneeId,
    newAssigneeId: newAssigneeId || null,
    archivedConversationId,
    activeConversationId: newActiveConversation.id,
    reassignedAt: now,
    sameAssignment: false
  };
}

async function reassignCustomerConversation(customerId, newAssigneeId, actor, options = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    return reassignCustomerConversationInTransaction(tx, {
      customerId,
      newAssigneeId,
      actor,
      reason: options.reason || null,
      newAssignee: options.newAssignee || null
    });
  });
}

function buildConversationWhere(user, query) {
  const where = conversationAccessWhere(user);
  const status = normalizeStatus(query.status);
  const archivedOnly = normalizeBoolean(query.archivedOnly) || status === "ARCHIVED";

  if (archivedOnly) {
    where.status = "ARCHIVED";
    where.archivedAt = { not: null };
  } else {
    where.activeKey = { not: null };
  }

  if (user.role === "ADMIN") {
    if (query.assignedEmployeeId) {
      where.assignedEmployeeId = query.assignedEmployeeId;
    }

    if (normalizeBoolean(query.unassignedOnly) || query.assignment === "unassigned") {
      where.assignedEmployeeId = null;
    }
  } else if (query.assignedEmployeeId) {
    const visibleIds = scopedConversationAssigneeIds(user);

    if (visibleIds.includes(query.assignedEmployeeId)) {
      where.assignedEmployeeId = query.assignedEmployeeId;
    }
  }

  if (status && status !== "ARCHIVED") {
    where.status = status;
  }

  if (normalizeBoolean(query.unreadOnly)) {
    where.unreadCount = { gt: 0 };
  }

  if (query.search) {
    const normalizedSearch = safeNormalizePhone(query.search);
    const phoneFilters = [
      { phone: { contains: query.search } },
      ...(normalizedSearch && normalizedSearch !== query.search ? [{ phone: { contains: normalizedSearch } }] : [])
    ];

    where.customer = {
      is: {
        OR: [
          { fullName: { contains: query.search, mode: "insensitive" } },
          { name: { contains: query.search, mode: "insensitive" } },
          { accountNumber: { contains: query.search, mode: "insensitive" } },
          { projectName: { contains: query.search, mode: "insensitive" } },
          { serviceNumber: { contains: query.search, mode: "insensitive" } },
          ...phoneFilters,
          { phones: { some: { phoneNumber: { contains: query.search } } } },
          { whatsappProfileName: { contains: query.search, mode: "insensitive" } }
        ]
      }
    };
  }

  return where;
}

async function listConversations(user, query) {
  const { page, limit, skip } = getPagination(query);
  const where = buildConversationWhere(user, query);

  const [items, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { lastMessageAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" }
      ],
      include: conversationInclude()
    }),
    prisma.conversation.count({ where })
  ]);

  return {
    items: items.map(formatConversation),
    meta: { page, limit, total }
  };
}

async function listConversationMessages(customerId, user, query) {
  const conversation = await getConversationForUser(customerId, user, {
    conversationId: query.conversationId || null
  });
  const limit = Math.min(Math.max(Number(query.limit || 100), 1), 200);
  const cursor = query.cursor;

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { conversationId: conversation.id },
        { customerId: conversation.customerId, conversationId: null }
      ]
    },
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "asc" },
    include: {
      sentByUser: {
        select: userSummarySelect
      }
    }
  });

  const formattedMessages = messages.map(formatMessageSummary);

  logger.debugStep("GET messages media URLs returned", {
    customerId,
    conversationId: conversation.id,
    mediaMessages: formattedMessages
      .filter((message) => message.mediaId || message.mediaUrl || ["IMAGE", "VIDEO", "AUDIO", "VOICE", "DOCUMENT", "STICKER"].includes(message.type))
      .map((message) => ({
        id: message.id,
        type: message.type,
        mediaId: message.mediaId,
        mediaUrl: message.mediaUrl,
        mimeType: message.mimeType,
        fileSize: message.fileSize,
        caption: message.caption
      }))
  });

  return {
    conversation: formatConversation(conversation),
    items: formattedMessages,
    meta: {
      limit,
      nextCursor: messages.length === limit ? messages[messages.length - 1].id : null
    }
  };
}

async function markConversationRead(customerId, user) {
  const conversation = await getConversationForUserByCustomerId(customerId, user);
  const now = new Date();

  const [updatedConversation, readState] = await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: 0 },
      include: conversationInclude()
    }),
    prisma.customerReadState.upsert({
      where: {
        customerId_userId: {
          customerId,
          userId: user.id
        }
      },
      update: {
        lastReadAt: now
      },
      create: {
        customerId,
        userId: user.id,
        lastReadAt: now
      }
    })
  ]);

  await safeRecordEmployeeActivity(user, "READ_CHAT", now);

  return {
    conversation: formatConversation(updatedConversation),
    readState
  };
}

async function updateConversationStatus(customerId, user, status) {
  const normalized = normalizeStatus(status);

  if (!normalized) {
    throw new ApiError(400, "Invalid conversation status");
  }

  if (normalized === "ARCHIVED") {
    throw new ApiError(400, "Conversation archiving is only available through customer reassignment");
  }

  const conversation = await getConversationForUserByCustomerId(customerId, user);
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: normalized },
    include: conversationInclude()
  });

  await safeRecordEmployeeActivity(user, "CHANGED_CONVERSATION_STATUS", new Date());

  return formatConversation(updated);
}

async function updateConversationPriority(customerId, user, priority) {
  const normalized = normalizePriority(priority);

  if (!normalized) {
    throw new ApiError(400, "Invalid conversation priority");
  }

  const conversation = await getConversationForUserByCustomerId(customerId, user);
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { priority: normalized },
    include: conversationInclude()
  });

  await safeRecordEmployeeActivity(user, "CHANGED_CONVERSATION_STATUS", new Date());

  return formatConversation(updated);
}

module.exports = {
  validStatuses,
  validPriorities,
  conversationInclude,
  formatConversation,
  conversationAccessWhere,
  ensureConversationForCustomer,
  syncConversationAssignment,
  reassignCustomerConversation,
  reassignCustomerConversationInTransaction,
  buildArchivedConversationSystemMessage,
  buildNewConversationSystemMessage,
  getConversationForUser,
  getConversationForUserByCustomerId,
  touchConversationForMessage,
  listConversations,
  listConversationMessages,
  markConversationRead,
  updateConversationStatus,
  updateConversationPriority
};
