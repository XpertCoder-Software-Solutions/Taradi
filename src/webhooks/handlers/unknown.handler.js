const logger = require("../../config/logger");

async function handleUnknown({ field, auditEventId }) {
  logger.info({ auditEventId, field }, "Ignoring unsupported WhatsApp webhook event");

  return {
    processed: 0,
    ignored: 1,
    unknown: {
      field: field || "unknown",
      ignored: true,
      reason: "unsupported_webhook_event"
    }
  };
}

module.exports = {
  handleUnknown
};
