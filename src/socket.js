const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const env = require("./config/env");
const prisma = require("./config/prisma");
const logger = require("./config/logger");
const { formatConversation } = require("./services/conversation.service");
const { handleSocketLogout, markSocketOnline, markSocketDisconnected } = require("./services/presence.service");

let io;

function getTokenFromSocket(socket) {
  const authToken = socket.handshake.auth && socket.handshake.auth.token;
  const header = socket.handshake.headers.authorization || "";

  if (authToken) {
    return authToken.startsWith("Bearer ") ? authToken.slice(7) : authToken;
  }

  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
      credentials: true
    }
  });

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

  return io;
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

function getCustomerAudienceTargets(customer) {
  const targets = [{ room: "admins", scope: "admins" }];

  if (customer.assignedToId) {
    targets.push({ room: `user:${customer.assignedToId}`, scope: "assigned_employee" });
  }

  const supervisorId = customer.assignedTo && customer.assignedTo.role === "EMPLOYEE"
    ? customer.assignedTo.supervisorId
    : null;

  if (supervisorId && supervisorId !== customer.assignedToId) {
    targets.push({ room: `user:${supervisorId}`, scope: "assigned_supervisor" });
  }

  return targets;
}

function emitToTargets(targets, event, payload) {
  if (!io) {
    logger.warn({ event }, "Socket.IO server is not initialized; event was not emitted");
    logger.debugStep("Socket.IO emit skipped", {
      socketEvent: event,
      socketRoom: null,
      connectedUsersCount: 0,
      reason: "io_not_initialized"
    });

    return {
      emitted: false,
      targets: []
    };
  }

  const emittedTargets = [];

  for (const target of targets) {
    const roomSocketCount = getRoomSocketCount(target.room);
    io.to(target.room).emit(event, payload);
    emittedTargets.push({
      room: target.room,
      event,
      scope: target.scope,
      roomSocketCount,
      connectedUsersCount: getConnectedUsersCount()
    });

    logger.info({
      event,
      room: target.room,
      scope: target.scope,
      conversationId: payload && payload.conversationId,
      customerId: payload && payload.customerId
    }, "Emitted Socket.IO event");

    logger.debugStep("Socket.IO emit", {
      socketRoom: target.room,
      socketEvent: event,
      scope: target.scope,
      connectedUsersCount: getConnectedUsersCount(),
      roomSocketCount,
      conversationId: payload && payload.conversationId,
      customerId: payload && payload.customerId
    });
  }

  return {
    emitted: emittedTargets.length > 0,
    targets: emittedTargets
  };
}

function emitToCustomerAudience(customer, event, payload) {
  return emitToTargets(getCustomerAudienceTargets(customer), event, payload);
}

async function emitUnreadCountNotifications(customer) {
  if (!io) {
    return;
  }

  const adminAggregate = await prisma.conversation.aggregate({
    _sum: { unreadCount: true }
  });
  const adminPayload = {
    unreadTotal: adminAggregate._sum.unreadCount || 0,
    scope: "admins"
  };

  io.to("admins").emit("notification:unread_count", adminPayload);
  logger.info({
    event: "notification:unread_count",
    room: "admins",
    unreadTotal: adminPayload.unreadTotal
  }, "Emitted Socket.IO unread count");
  logger.debugStep("Socket.IO emit", {
    socketRoom: "admins",
    socketEvent: "notification:unread_count",
    connectedUsersCount: getConnectedUsersCount(),
    roomSocketCount: getRoomSocketCount("admins"),
    unreadTotal: adminPayload.unreadTotal
  });

  if (customer.assignedToId) {
    const employeeAggregate = await prisma.conversation.aggregate({
      where: { assignedEmployeeId: customer.assignedToId },
      _sum: { unreadCount: true }
    });
    const employeePayload = {
      unreadTotal: employeeAggregate._sum.unreadCount || 0,
      scope: "assigned_employee"
    };

    io.to(`user:${customer.assignedToId}`).emit("notification:unread_count", employeePayload);
    logger.info({
      event: "notification:unread_count",
      room: `user:${customer.assignedToId}`,
      unreadTotal: employeePayload.unreadTotal
    }, "Emitted Socket.IO unread count");
    logger.debugStep("Socket.IO emit", {
      socketRoom: `user:${customer.assignedToId}`,
      socketEvent: "notification:unread_count",
      connectedUsersCount: getConnectedUsersCount(),
      roomSocketCount: getRoomSocketCount(`user:${customer.assignedToId}`),
      unreadTotal: employeePayload.unreadTotal
    });
  }

  const supervisorId = customer.assignedTo && customer.assignedTo.role === "EMPLOYEE"
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
        }
      },
      _sum: { unreadCount: true }
    });
    const supervisorPayload = {
      unreadTotal: supervisorAggregate._sum.unreadCount || 0,
      scope: "assigned_supervisor"
    };

    io.to(`user:${supervisorId}`).emit("notification:unread_count", supervisorPayload);
    logger.info({
      event: "notification:unread_count",
      room: `user:${supervisorId}`,
      unreadTotal: supervisorPayload.unreadTotal
    }, "Emitted Socket.IO unread count");
  }
}

function buildConversationPayload(customer, message, conversation) {
  const conversationSummary = conversation ? formatConversation(conversation) : null;

  return {
    conversationId: conversationSummary ? conversationSummary.id : message.conversationId,
    customerId: customer.id,
    customer,
    message,
    conversation: conversationSummary,
    unreadCount: conversationSummary ? conversationSummary.unreadCount : null
  };
}

function notifyInboundMessage(customer, message, conversation) {
  const payload = buildConversationPayload(customer, message, conversation);
  const emitResults = [];

  emitResults.push(emitToCustomerAudience(customer, "conversation:new_message", payload));
  emitResults.push(emitToCustomerAudience(customer, "conversation:updated", payload));

  emitResults.push(emitToCustomerAudience(customer, "message:received", {
    customerId: customer.id,
    customer,
    message,
    conversation: payload.conversation,
    conversationId: payload.conversationId,
    unreadCount: payload.unreadCount
  }));

  emitResults.push(emitToCustomerAudience(customer, "inbox:updated", {
    customerId: customer.id,
    conversationId: payload.conversationId,
    reason: "inbound_message"
  }));

  emitUnreadCountNotifications(customer).catch((error) => {
    logger.warn({ err: error, customerId: customer.id }, "Failed to emit unread count notification");
  });

  return {
    emitted: emitResults.some((result) => result && result.emitted),
    targets: emitResults.flatMap((result) => (result && result.targets ? result.targets : []))
  };
}

function notifyOutboundMessage(customer, message) {
  emitToCustomerAudience(customer, "message:sent", {
    customer,
    message
  });

  emitToCustomerAudience(customer, "inbox:updated", {
    customerId: customer.id,
    reason: "outbound_message"
  });
}

function notifyMessageStatus(message) {
  if (!io || !message) {
    return;
  }

  io.to("admins").emit("message:status", { message });

  if (message.customer && message.customer.assignedToId) {
    io.to(`user:${message.customer.assignedToId}`).emit("message:status", { message });
  }

  const supervisorId = message.customer && message.customer.assignedTo && message.customer.assignedTo.role === "EMPLOYEE"
    ? message.customer.assignedTo.supervisorId
    : null;

  if (supervisorId && supervisorId !== message.customer.assignedToId) {
    io.to(`user:${supervisorId}`).emit("message:status", { message });
  }
}

module.exports = {
  initSocket,
  notifyInboundMessage,
  notifyOutboundMessage,
  notifyMessageStatus
};
