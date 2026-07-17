const prisma = require("../config/prisma");
const logger = require("../config/logger");

function jsonValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

async function recordCampaignAudit(data) {
  try {
    return await prisma.campaignAuditLog.create({
      data: {
        action: data.action,
        actorId: data.actorId || null,
        campaignId: data.campaignId || null,
        customerId: data.customerId || null,
        oldValue: jsonValue(data.oldValue),
        newValue: jsonValue(data.newValue),
        reason: data.reason || null
      }
    });
  } catch (error) {
    logger.error({ err: error, action: data.action }, "Failed to write campaign audit log");
    return null;
  }
}

module.exports = { recordCampaignAudit };
