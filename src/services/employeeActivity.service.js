const prisma = require("../config/prisma");
const logger = require("../config/logger");

const employeeActivityTypes = [
  "LOGIN",
  "SENT_MESSAGE",
  "READ_CHAT",
  "UPDATED_CUSTOMER",
  "ASSIGNED_CUSTOMER",
  "CHANGED_CONVERSATION_STATUS",
  "NONE"
];

function normalizeActivityType(type) {
  return employeeActivityTypes.includes(type) ? type : "NONE";
}

function getUserId(userOrId) {
  if (!userOrId) {
    return null;
  }

  return typeof userOrId === "string" ? userOrId : userOrId.id;
}

async function recordEmployeeActivity(userOrId, type, occurredAt = new Date()) {
  const userId = getUserId(userOrId);

  if (!userId) {
    return null;
  }

  const normalizedType = normalizeActivityType(type);
  const data = {
    lastActivityAt: occurredAt,
    lastActivityType: normalizedType
  };

  if (normalizedType === "LOGIN") {
    data.lastLoginAt = occurredAt;
  }

  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      lastLoginAt: true,
      lastActivityAt: true,
      lastActivityType: true
    }
  });
}

async function safeRecordEmployeeActivity(userOrId, type, occurredAt = new Date()) {
  try {
    return await recordEmployeeActivity(userOrId, type, occurredAt);
  } catch (error) {
    logger.warn({
      err: error,
      userId: getUserId(userOrId),
      activityType: type
    }, "Failed to update employee activity");
    return null;
  }
}

module.exports = {
  employeeActivityTypes,
  recordEmployeeActivity,
  safeRecordEmployeeActivity
};
