const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const env = require("./config/env");
const prisma = require("./config/prisma");
const logger = require("./config/logger");
const { createRedisConnection } = require("./config/redis");
const { formatConversation } = require("./services/conversation.service");
const { handleSocketLogout, markSocketOnline, markSocketDisconnected } = require("./services/presence.service");
const {
  claimRealtimeEvent,
  closeRealtimeEventBus,
  normalizeRealtimeEvent,
  safePublishRealtimeEvent,
  subscribeRealtimeEvents
} = require("./realtime/eventBus");

let io;
let adapterPubClient = null;
let adapterSubClient = null;
let realtimeSubscriberStarted = false;
let publishRealtimeEvent = safePublishRealtimeEvent;
let emitUnreadCounts = emitUnreadCountNotifications;

function getTokenFromSocket(socket) {
  const authToken = socket.handshake.auth && socket.handshake.auth.token;
  const header = socket.handshake.headers.authorization || "";

  if (authToken) {
    return authToken.startsWith("Bearer ") ? authToken.slice(7) : authToken;
  }

  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function wireSocketRedisLogging(client, role) {
  client.on("ready", () => {
    logger.info({ role }, "Socket.IO Redis adapter connection ready");
  });

  client.on("close", () => {
    logger.warn({ role }, "Socket.IO Redis adapter connection closed");
  });

  client.on("reconnecting", (delay) => {
    logger.warn({ role, delay }, "Socket.IO Redis adapter connection reconnecting");
  });
}

function configureSocketRedisAdapter(serverIo) {
  if (adapterPubClient && adapterSubClient) {
    return;
  }

  try {
    adapterPubClient = createRedisConnection({
      connectionName: "taradi-socket-adapter-publisher"
    });
    adapterSubClient = adapterPubClient.duplicate({
      connectionName: "taradi-socket-adapter-subscriber"
    });

    wireSocketRedisLogging(adapterPubClient, "socket_adapter_publisher");
    wireSocketRedisLogging(adapterSubClient, "socket_adapter_subscriber");
    serverIo.adapter(createAdapter(adapterPubClient, adapterSubClient));
    logger.info("Socket.IO Redis adapter configured");
  } catch (error) {
    logger.error({ err: error }, "Failed to configure Socket.IO Redis adapter");
  }
}

function initSocket(server) {
  const corsOrigin = env.CORS_ORIGIN === "*"
    ? true
    : env.CORS_ORIGINS.length === 1 ? env.CORS_ORIGINS[0] : env.CORS_ORIGINS;

  io = new Server(server, {
    cors: {
      origin: corsOrigin,
      credentials: true
    }
  });

  configureSocketRedisAdapter(io);

  io.use(async (socket, next) => {
    try {
      const token = getTokenFromSocket(socket);

      if (!token) {
        return next(new Error("Authentication token is required"));
      }

      const payload = jwt.verify(token, env.JWT_SECRET);
      const user = await prisma.user.findFirst({
        where: {
          id: payload.sub,
          isActive: true
        },
        select: {
          id: true,
          email: true,
          employeeCode: true,
          name: true,
          role: true,
          supervisorId: true
        }
      });

      if (!user) {
        return next(new Error("Authenticated user no longer exists or is inactive"));
      }

      socket.user = user;
      return next();
    } catch (error) {
      return next(new Error("Invalid or expired authentication token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.user.id}`);

    if (socket.user.role === "ADMIN") {
      socket.join("admins");
    }

    markSocketOnline(io, socket);

    logger.info({
      userId: socket.user.id,
      role: socket.user.role
    }, "Socket connected");

    logger.debugStep("Socket connected", {
      userId: socket.user.id,
      role: socket.user.role,
      rooms: [...socket.rooms],
      connectedUsersCount: getConnectedUsersCount()
    });

    socket.emit("socket:ready", { userId: socket.user.id });

    socket.on("conversation:join", async (payload = {}, ack) => {
      const conversationId = payload && payload.conversationId ? String(payload.conversationId) : "";
      const room = `conversation:${conversationId}`;

      try {
        const allowed = await canAccessConversationRoom(socket.user, conversationId);

        if (!allowed) {
          if (typeof ack === "function") {
            ack({ ok: false, message: "conversation_not_accessible" });
          }

          return;
        }

        socket.join(room);
        logger.debugStep("Socket joined conversation room", {
          userId: socket.user.id,
          conversationId,
          room
        });

        if (typeof ack === "function") {
          ack({ ok: true, room });
        }
      } catch (error) {
        logger.warn({ err: error, userId: socket.user.id, conversationId }, "Failed to join conversation room");

        if (typeof ack === "function") {
          ack({ ok: false, message: "conversation_join_failed" });
        }
      }
    });

    socket.on("conversation:leave", (payload = {}, ack) => {
      const conversationId = payload && payload.conversationId ? String(payload.conversationId) : "";

      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
      }

      if (typeof ack === "function") {
        ack({ ok: true });
      }
    });

    socket.on("presence:logout", async (payload = {}, ack) => {
      const reason = payload && payload.reason ? String(payload.reason) : "logout";

      logger.debugStep("Socket presence:logout received", {
        userId: socket.user.id,
        role: socket.user.role,
        socketId: socket.id,
        reason
      });

      try {
        const result = await handleSocketLogout(io, socket, reason);

        if (typeof ack === "function") {
          ack(result);
        }

        logger.debugStep("Socket presence:logout completed", {
          userId: socket.user.id,
          socketId: socket.id,
          reason,
          result
        });
      } catch (error) {
        logger.warn({ err: error, userId: socket.user.id, socketId: socket.id }, "Failed to process presence logout");

        if (typeof ack === "function") {
          ack({
            ok: false,
            message: "presence_logout_failed"
          });
        }
      } finally {
        socket.disconnect(true);
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info({
        userId: socket.user.id,
        role: socket.user.role,
        reason
      }, "Socket disconnected");

      logger.debugStep("Socket disconnected", {
        userId: socket.user.id,
        role: socket.user.role,
        socketId: socket.id,
        reason,
        connectedUsersCount: getConnectedUsersCount()
      });

      markSocketDisconnected(io, socket);
    });
  });

  startRealtimeEventSubscriber();

  return io;
}

async function canAccessConversationRoom(user, conversationId) {
  if (!conversationId) {
    return false;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      assignedEmployeeId: true,
      assignedEmployee: {
        select: {
          id: true,
          supervisorId: true
        }
      }
    }
  });

  if (!conversation) {
    return false;
  }

  if (user.role === "ADMIN") {
    return true;
  }

  if (conversation.assignedEmployeeId === user.id) {
    return true;
  }

  return Boolean(conversation.assignedEmployee && conversation.assignedEmployee.supervisorId === user.id);
}

function getConnectedUsersCount() {
  if (!io) {
    return 0;
  }

  const userIds = new Set();

  for (const socket of io.sockets.sockets.values()) {
    if (socket.user && socket.user.id) {
      userIds.add(socket.user.id);
    }
  }

  return userIds.size;
}

function getRoomSocketCount(room) {
  if (!io || !room) {
    return 0;
  }

  const sockets = io.sockets.adapter.rooms.get(room);
  return sockets ? sockets.size : 0;
}

function getPrimaryPhone(customer) {
  const primary = customer && Array.isArray(customer.phones)
    ? customer.phones.find((phone) => phone.isPrimary) || customer.phones[0]
    : null;

  return primary ? primary.phoneNumber : customer && customer.phone ? customer.phone : null;
}

function formatRealtimeCustomer(customer) {
  if (!customer) {
    return null;
  }

  const phone = getPrimaryPhone(customer);

  return {
    id: customer.id,
    name: customer.fullName || customer.name || customer.whatsappProfileName || phone,
    fullName: customer.fullName || customer.name || customer.whatsappProfileName || phone,
    phone,
    primaryPhone: phone,
    accountNumber: customer.accountNumber || null,
    projectName: customer.projectName || null,
    collectionStatus: customer.collectionStatus || null,
    collectionStatusLabel: customer.collectionStatusLabel || null,
    contactBlocked: Boolean(customer.contactBlocked),
    whatsappProfileName: customer.whatsappProfileName || null,
    assignedToId: customer.assignedToId || null,
    assignedTo: customer.assignedTo ? {
      id: customer.assignedTo.id,
      employeeCode: customer.assignedTo.employeeCode || null,
      name: customer.assignedTo.name,
      role: customer.assignedTo.role,
      supervisorId: customer.assignedTo.supervisorId || null
    } : null,
    source: customer.source || null
  };
}

function formatRealtimeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    employeeCode: user.employeeCode || null,
    name: user.name,
    role: user.role,
    supervisorId: user.supervisorId || null
  };
}

function minimalRawPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") {
    return null;
  }

  const source = rawPayload.source || (rawPayload.queued && rawPayload.queued.source);

  if (!source) {
    return null;
  }

  return rawPayload.source
    ? { source }
    : { queued: { source } };
}

function formatRealtimeMessage(message) {
  if (!message) {
    return null;
  }

  return {
    id: message.id,
    customerId: message.customerId,
    conversationId: message.conversationId || null,
    direction: message.direction,
    type: message.type,
    body: message.body || message.content || null,
    content: message.content || null,
    mediaUrl: message.mediaUrl || null,
    mediaId: message.mediaId || null,
    mimeType: message.mimeType || null,
    fileName: message.fileName || null,
    fileSize: message.fileSize || null,
    caption: message.caption || null,
    duration: message.duration || null,
    templateName: message.templateName || null,
    whatsappMessageId: message.whatsappMessageId || null,
    status: message.status,
    statusUpdatedAt: message.statusUpdatedAt || null,
    sentByUserId: message.sentByUserId || null,
    sentByUser: formatRealtimeUser(message.sentByUser),
    rawPayload: minimalRawPayload(message.rawPayload),
    error: message.error || null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt
  };
}

function getCustomerAudienceTargets(customer, conversationId) {
  const targets = [{ room: "admins", scope: "admins" }];

  if (conversationId) {
    targets.push({ room: `conversation:${conversationId}`, scope: "conversation" });
  }

  if (customer && customer.assignedToId) {
    targets.push({ room: `user:${customer.assignedToId}`, scope: "assigned_employee" });
  }

  const supervisorId = customer && customer.assignedTo && customer.assignedTo.role === "EMPLOYEE"
    ? customer.assignedTo.supervisorId
    : null;

  if (supervisorId && supervisorId !== customer.assignedToId) {
    targets.push({ room: `user:${supervisorId}`, scope: "assigned_supervisor" });
  }

  return targets;
}

function uniqueTargets(targets) {
  const seenRooms = new Set();

  return (targets || []).filter((target) => {
    if (!target || !target.room || seenRooms.has(target.room)) {
      return false;
    }

    seenRooms.add(target.room);
    return true;
  });
}

function emitRealtimeEnvelope(envelope, server = io) {
  const event = normalizeRealtimeEvent(envelope);

  if (!server) {
    return {
      emitted: false,
      targets: [],
      reason: "io_not_initialized"
    };
  }

  const rooms = event.rooms;

  if (rooms.length > 0) {
    server.to(rooms).emit(event.event, event.payload);
  } else {
    server.emit(event.event, event.payload);
  }

  logger.info({
    id: event.id,
    event: event.event,
    rooms,
    conversationId: event.payload && event.payload.conversationId,
    customerId: event.payload && event.payload.customerId
  }, "Emitted realtime Socket.IO event");

  return {
    emitted: true,
    targets: rooms.map((room) => ({
      room,
      event: event.event,
      roomSocketCount: getRoomSocketCount(room),
      connectedUsersCount: getConnectedUsersCount()
    }))
  };
}

function createRealtimeEventHandler(server = io, options = {}) {
  const claim = options.claimRealtimeEvent || claimRealtimeEvent;

  return async (event) => {
    const claimed = await claim(event);

    if (!claimed) {
      logger.info({ eventId: event.id, event: event.event }, "Skipped duplicate realtime event");
      return {
        emitted: false,
        duplicate: true
      };
    }

    return emitRealtimeEnvelope(event, server);
  };
}

function startRealtimeEventSubscriber() {
  if (realtimeSubscriberStarted) {
    return;
  }

  realtimeSubscriberStarted = true;
  subscribeRealtimeEvents(createRealtimeEventHandler(io)).catch((error) => {
    realtimeSubscriberStarted = false;
    logger.error({ err: error }, "Failed to subscribe to realtime Redis events");
  });
}

async function emitToTargets(targets, event, payload) {
  const safeTargets = uniqueTargets(targets);
  const rooms = safeTargets.map((target) => target.room);

  if (!io) {
    let publishResult;

    try {
      publishResult = await publishRealtimeEvent({
        event,
        rooms,
        payload,
        source: "worker"
      });
    } catch (error) {
      logger.warn({ err: error, event, rooms }, "Realtime publish failed; event will not block persistence");
      publishResult = { published: false, error };
    }

    return {
      emitted: false,
      published: Boolean(publishResult && publishResult.published),
      targets: safeTargets.map((target) => ({
        room: target.room,
        event,
        scope: target.scope
      }))
    };
  }

  return emitRealtimeEnvelope({ event, rooms, payload, source: "api" }, io);
}

async function emitToCustomerAudience(customer, conversationId, event, payload) {
  return emitToTargets(getCustomerAudienceTargets(customer, conversationId), event, payload);
}

async function emitUnreadCountNotifications(customer) {
  const emitResults = [];
  const adminAggregate = await prisma.conversation.aggregate({
    where: { activeKey: { not: null } },
    _sum: { unreadCount: true }
  });
  const adminPayload = {
    unreadTotal: adminAggregate._sum.unreadCount || 0,
    scope: "admins"
  };
  const adminTargets = [{ room: "admins", scope: "admins" }];

  emitResults.push(await emitToTargets(adminTargets, "unread-count:updated", adminPayload));
  emitResults.push(await emitToTargets(adminTargets, "notification:unread_count", adminPayload));

  if (customer && customer.assignedToId) {
    const employeeAggregate = await prisma.conversation.aggregate({
      where: {
        assignedEmployeeId: customer.assignedToId,
        activeKey: { not: null }
      },
      _sum: { unreadCount: true }
    });
    const employeePayload = {
      unreadTotal: employeeAggregate._sum.unreadCount || 0,
      scope: "assigned_employee"
    };
    const employeeTargets = [{ room: `user:${customer.assignedToId}`, scope: "assigned_employee" }];

    emitResults.push(await emitToTargets(employeeTargets, "unread-count:updated", employeePayload));
    emitResults.push(await emitToTargets(employeeTargets, "notification:unread_count", employeePayload));
  }

  const supervisorId = customer && customer.assignedTo && customer.assignedTo.role === "EMPLOYEE"
    ? customer.assignedTo.supervisorId
    : null;

  if (supervisorId) {
    const directReports = await prisma.user.findMany({
      where: {
        supervisorId,
        role: "EMPLOYEE",
        isActive: true
      },
      select: { id: true }
    });
    const supervisorAggregate = await prisma.conversation.aggregate({
      where: {
        assignedEmployeeId: {
          in: [supervisorId, ...directReports.map((employee) => employee.id)]
        },
        activeKey: { not: null }
      },
      _sum: { unreadCount: true }
    });
    const supervisorPayload = {
      unreadTotal: supervisorAggregate._sum.unreadCount || 0,
      scope: "assigned_supervisor"
    };
    const supervisorTargets = [{ room: `user:${supervisorId}`, scope: "assigned_supervisor" }];

    emitResults.push(await emitToTargets(supervisorTargets, "unread-count:updated", supervisorPayload));
    emitResults.push(await emitToTargets(supervisorTargets, "notification:unread_count", supervisorPayload));
  }

  return emitResults;
}

function buildConversationPayload(customer, message, conversation) {
  const conversationSummary = conversation ? formatConversation(conversation) : null;
  const safeMessage = formatRealtimeMessage(message);

  return {
    conversationId: conversationSummary ? conversationSummary.id : message.conversationId,
    customerId: customer.id,
    customer: formatRealtimeCustomer(customer),
    message: safeMessage,
    conversation: conversationSummary,
    unreadCount: conversationSummary ? conversationSummary.unreadCount : null
  };
}

async function notifyInboundMessage(customer, message, conversation) {
  const payload = buildConversationPayload(customer, message, conversation);
  const emitResults = [];

  emitResults.push(await emitToCustomerAudience(customer, payload.conversationId, "conversation:new_message", payload));
  emitResults.push(await emitToCustomerAudience(customer, payload.conversationId, "conversation:updated", payload));
  emitResults.push(await emitToCustomerAudience(customer, payload.conversationId, "message:received", {
    customerId: customer.id,
    customer: payload.customer,
    message: payload.message,
    conversation: payload.conversation,
    conversationId: payload.conversationId,
    unreadCount: payload.unreadCount
  }));
  emitResults.push(await emitToCustomerAudience(customer, payload.conversationId, "inbox:updated", {
    customerId: customer.id,
    conversationId: payload.conversationId,
    conversation: payload.conversation,
    message: payload.message,
    reason: "inbound_message"
  }));

  try {
    emitResults.push(...await emitUnreadCounts(customer));
  } catch (error) {
    logger.warn({ err: error, customerId: customer.id }, "Failed to emit unread count notification");
  }

  return {
    emitted: emitResults.some((result) => result && result.emitted),
    published: emitResults.some((result) => result && result.published),
    targets: emitResults.flatMap((result) => (result && result.targets ? result.targets : []))
  };
}

function notifyOutboundMessage(customer, message) {
  const safeMessage = formatRealtimeMessage(message);
  const conversationId = safeMessage && safeMessage.conversationId;

  void (async () => {
    await emitToCustomerAudience(customer, conversationId, "message:sent", {
      customer: formatRealtimeCustomer(customer),
      message: safeMessage,
      conversationId
    });

    await emitToCustomerAudience(customer, conversationId, "inbox:updated", {
      customerId: customer.id,
      conversationId,
      reason: "outbound_message"
    });
  })().catch((error) => {
    logger.warn({ err: error, customerId: customer && customer.id }, "Failed to notify outbound message");
  });
}

async function notifyMessageStatus(message) {
  if (!message) {
    return {
      emitted: false,
      targets: []
    };
  }

  try {
    const safeMessage = formatRealtimeMessage(message);
    return await emitToCustomerAudience(message.customer, safeMessage && safeMessage.conversationId, "message:status", {
      message: safeMessage
    });
  } catch (error) {
    logger.warn({ err: error, messageId: message.id }, "Failed to notify message status");
    return {
      emitted: false,
      targets: []
    };
  }
}

async function closeSocketRealtime() {
  const adapterClients = [adapterSubClient, adapterPubClient];
  adapterSubClient = null;
  adapterPubClient = null;
  realtimeSubscriberStarted = false;
  io = null;

  await Promise.all(adapterClients.filter(Boolean).map(async (client) => {
    if (client.status !== "end") {
      await client.quit();
    }
  }));

  await closeRealtimeEventBus();
}

function setRealtimeEventPublisherForTests(publisher) {
  publishRealtimeEvent = typeof publisher === "function" ? publisher : safePublishRealtimeEvent;
}

function setUnreadCountEmitterForTests(emitter) {
  emitUnreadCounts = typeof emitter === "function" ? emitter : emitUnreadCountNotifications;
}

module.exports = {
  initSocket,
  closeSocketRealtime,
  notifyInboundMessage,
  notifyOutboundMessage,
  notifyMessageStatus,
  emitRealtimeEnvelope,
  createRealtimeEventHandler,
  buildConversationPayload,
  getCustomerAudienceTargets,
  formatRealtimeMessage,
  formatRealtimeCustomer,
  _setRealtimeEventPublisherForTests: setRealtimeEventPublisherForTests,
  _setUnreadCountEmitterForTests: setUnreadCountEmitterForTests
};
