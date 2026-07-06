const prisma = require("../config/prisma");
const logger = require("../config/logger");

const OFFLINE_GRACE_MS = 25 * 1000;
const onlineSocketIdsByUser = new Map();
const offlineTimersByUser = new Map();
const lastSeenByUser = new Map();

function getUserId(userOrId) {
  return typeof userOrId === "string" ? userOrId : userOrId && userOrId.id;
}

function getPresenceAudienceTargets(user) {
  const targets = [
    { room: `user:${user.id}`, scope: "self" },
    { room: "admins", scope: "admins" }
  ];

  if (user.role === "EMPLOYEE" && user.supervisorId) {
    targets.push({ room: `user:${user.supervisorId}`, scope: "supervisor" });
  }

  return targets;
}

function getTrackedSocketCount(userId) {
  return onlineSocketIdsByUser.get(userId)?.size || 0;
}

function isUserOnline(userOrId) {
  const userId = getUserId(userOrId);
  return Boolean(userId && onlineSocketIdsByUser.has(userId));
}

function getOnlineUserIds(userIds) {
  const onlineIds = [...onlineSocketIdsByUser.keys()];

  if (!Array.isArray(userIds)) {
    return onlineIds;
  }

  const allowedIds = new Set(userIds);
  return onlineIds.filter((userId) => allowedIds.has(userId));
}

function clearOfflineTimer(userId) {
  const timer = offlineTimersByUser.get(userId);

  if (timer) {
    clearTimeout(timer);
    offlineTimersByUser.delete(userId);
    return true;
  }

  return false;
}

function emitPresenceEvent(io, user, event, payload) {
  if (!io) {
    return;
  }

  for (const target of getPresenceAudienceTargets(user)) {
    io.to(target.room).emit(event, payload);
  }
}

async function saveLastSeenAt(user, occurredAt = new Date()) {
  let savedLastSeenAt = occurredAt;

  try {
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: occurredAt },
      select: {
        id: true,
        lastSeenAt: true
      }
    });
    savedLastSeenAt = updatedUser.lastSeenAt || occurredAt;
    logger.info({
      userId: user.id,
      lastSeenAt: savedLastSeenAt.toISOString()
    }, "Employee lastSeenAt saved");
    logger.debugStep("Presence lastSeenAt saved", {
      userId: user.id,
      lastSeenAt: savedLastSeenAt.toISOString()
    });
  } catch (error) {
    logger.warn({ err: error, userId: user.id, lastSeenAt: occurredAt.toISOString() }, "Failed to update employee lastSeenAt");
  }

  lastSeenByUser.set(user.id, savedLastSeenAt);
  return savedLastSeenAt;
}

async function markUserOffline(io, user, reason) {
  onlineSocketIdsByUser.delete(user.id);
  offlineTimersByUser.delete(user.id);

  const savedLastSeenAt = await saveLastSeenAt(user);
  const payload = {
    userId: user.id,
    isOnline: false,
    lastSeenAt: savedLastSeenAt.toISOString()
  };

  logger.debugStep("Presence user marked offline", {
    userId: user.id,
    lastSeenAt: payload.lastSeenAt,
    activeSocketsCount: 0,
    reason
  });
  emitPresenceEvent(io, user, "presence:user_offline", payload);
  logger.debugStep("presence:user_offline emitted", payload);

  return payload;
}

function markSocketOnline(io, socket) {
  const user = socket.user;

  if (!user || !user.id) {
    return;
  }

  const wasOffline = !onlineSocketIdsByUser.has(user.id);
  const cancelledGracePeriod = clearOfflineTimer(user.id);

  if (cancelledGracePeriod) {
    logger.debugStep("Presence grace period cancelled", {
      userId: user.id,
      socketId: socket.id,
      activeSocketsCount: getTrackedSocketCount(user.id)
    });
  }

  const socketIds = onlineSocketIdsByUser.get(user.id) || new Set();
  socketIds.add(socket.id);
  onlineSocketIdsByUser.set(user.id, socketIds);

  logger.debugStep("Presence socket connected", {
    userId: user.id,
    socketId: socket.id,
    activeSocketsCount: socketIds.size,
    wasOffline
  });

  if (wasOffline) {
    const payload = {
      userId: user.id,
      isOnline: true,
      lastSeenAt: null
    };

    emitPresenceEvent(io, user, "presence:user_online", payload);
    logger.debugStep("presence:user_online emitted", {
      ...payload,
      activeSocketsCount: socketIds.size
    });
  }
}

function markSocketDisconnected(io, socket) {
  const user = socket.user;

  if (!user || !user.id) {
    return;
  }

  const socketIds = onlineSocketIdsByUser.get(user.id);

  if (!socketIds) {
    logger.debugStep("Presence disconnect ignored", {
      userId: user.id,
      socketId: socket.id,
      reason: "user_not_tracked"
    });
    return;
  }

  socketIds.delete(socket.id);

  logger.debugStep("Presence socket disconnected", {
    userId: user.id,
    socketId: socket.id,
    activeSocketsCount: socketIds.size
  });

  if (socketIds.size > 0) {
    logger.debugStep("Presence user remains online", {
      userId: user.id,
      socketId: socket.id,
      activeSocketsCount: socketIds.size
    });
    return;
  }

  clearOfflineTimer(user.id);

  logger.debugStep("Presence offline grace period started", {
    userId: user.id,
    socketId: socket.id,
    graceMs: OFFLINE_GRACE_MS,
    activeSocketsCount: 0
  });

  const timer = setTimeout(async () => {
    const latestSocketIds = onlineSocketIdsByUser.get(user.id);

    if (latestSocketIds && latestSocketIds.size > 0) {
      logger.debugStep("Presence offline skipped after grace", {
        userId: user.id,
        activeSocketsCount: latestSocketIds.size,
        reason: "reconnected"
      });
      return;
    }

    await markUserOffline(io, user, "disconnect_grace_elapsed");
  }, OFFLINE_GRACE_MS);

  offlineTimersByUser.set(user.id, timer);
}

async function handleSocketLogout(io, socket, reason = "logout") {
  const user = socket.user;

  if (!user || !user.id) {
    return {
      ok: false,
      isOnline: false,
      activeSocketsCount: 0
    };
  }

  const beforeCount = getTrackedSocketCount(user.id);
  const cancelledGracePeriod = clearOfflineTimer(user.id);
  const socketIds = onlineSocketIdsByUser.get(user.id);

  if (socketIds) {
    socketIds.delete(socket.id);
  }

  const afterCount = getTrackedSocketCount(user.id);

  logger.info({
    userId: user.id,
    socketId: socket.id,
    reason,
    activeSocketsBefore: beforeCount,
    activeSocketsAfter: afterCount
  }, "Presence logout received");
  logger.debugStep("presence:logout received", {
    userId: user.id,
    socketId: socket.id,
    reason,
    activeSocketsBefore: beforeCount,
    activeSocketsAfter: afterCount,
    cancelledGracePeriod
  });

  if (socketIds && socketIds.size > 0) {
    logger.debugStep("Presence logout kept user online", {
      userId: user.id,
      socketId: socket.id,
      activeSocketsCount: socketIds.size
    });

    return {
      ok: true,
      isOnline: true,
      activeSocketsCount: socketIds.size,
      lastSeenAt: null
    };
  }

  const payload = await markUserOffline(io, user, "presence_logout");

  return {
    ok: true,
    isOnline: false,
    activeSocketsCount: 0,
    lastSeenAt: payload.lastSeenAt
  };
}

async function getPresenceForUserIds(userIds) {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];

  if (!uniqueUserIds.length) {
    return {
      onlineUserIds: [],
      lastSeen: {}
    };
  }

  const users = await prisma.user.findMany({
    where: {
      id: { in: uniqueUserIds }
    },
    select: {
      id: true,
      lastSeenAt: true
    }
  });
  const dbLastSeenByUser = new Map(users.map((user) => [user.id, user.lastSeenAt]));
  const lastSeen = {};

  for (const userId of uniqueUserIds) {
    const value = lastSeenByUser.get(userId) || dbLastSeenByUser.get(userId) || null;
    lastSeen[userId] = value ? value.toISOString() : null;
  }

  return {
    onlineUserIds: getOnlineUserIds(uniqueUserIds),
    lastSeen
  };
}

module.exports = {
  markSocketOnline,
  markSocketDisconnected,
  handleSocketLogout,
  getPresenceForUserIds,
  getOnlineUserIds,
  isUserOnline
};
