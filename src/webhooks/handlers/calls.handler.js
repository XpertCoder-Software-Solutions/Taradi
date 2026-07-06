const logger = require("../../config/logger");

async function handleCalls({ auditEventId }) {
  logger.info({ auditEventId }, "Ignoring WhatsApp calls webhook event");

  return {
    processed: 0,
    ignored: 1,
    calls: {
      ignored: true,
      reason: "calls_not_supported"
    }
  };
}

module.exports = {
  handleCalls
};
