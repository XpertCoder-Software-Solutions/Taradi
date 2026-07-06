const prisma = require("../config/prisma");
const ApiError = require("../utils/apiError");
const getPagination = require("../utils/pagination");
const { safeNormalizePhone } = require("../utils/normalizePhone");
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

const validStatuses = ["OPEN", "PENDING", "CLOSED"];
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
    error: message.error,
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
          whatsappProfileName: conversation.customer.whatsappProfileName
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
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
}

async function getCustomerAssignment(customerId) {
  const customer = await prisma.customer.findUnique({
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
  const customer = await getCustomerAssignment(customerId);
  const assignedEmployeeId = Object.prototype.hasOwnProperty.call(options, "assignedEmployeeId")
    ? options.assignedEmployeeId
    : customer.assignedToId;

  const data = {
    assignedEmployeeId: assignedEmployeeId || null
  };

  if (options.tags) {
    data.tags = options.tags;
  }

  return prisma.conversation.upsert({
    where: { customerId },
    update: data,
    create: {
      customerId,
      assignedEmployeeId: assignedEmployeeId || null,
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

async function getConversationForUserByCustomerId(customerId, user) {
  const conversation = await ensureConversationForCustomer(customerId, {
    include: conversationInclude()
  });

  if (user.role !== "ADMIN") {
    const visibleIds = scopedConversationAssigneeIds(user);

    if (!conversation.assignedEmployeeId || !visibleIds.includes(conversation.assignedEmployeeId)) {
      throw new ApiError(404, "Conversation not found or not accessible");
    }
  }

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

function buildConversationWhere(user, query) {
  const where = conversationAccessWhere(user);

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

  const status = normalizeStatus(query.status);
  if (status) {
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
  const conversation = await getConversationForUserByCustomerId(customerId, user);
  const limit = Math.min(Math.max(Number(query.limit || 100), 1), 200);
  const cursor = query.cursor;

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { conversationId: conversation.id },
        { customerId: conversation.customerId }
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

  return {
    conversation: formatConversation(conversation),
    items: messages.map(formatMessageSummary),
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
  getConversationForUserByCustomerId,
  touchConversationForMessage,
  listConversations,
  listConversationMessages,
  markConversationRead,
  updateConversationStatus,
  updateConversationPriority
};
