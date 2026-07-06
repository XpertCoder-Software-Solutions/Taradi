const logger = require("../../config/logger");

async function handleAccountAlerts({ value, auditEventId }) {
  const details = {
    alertType: value.alert_type || value.type || null,
    severity: value.severity || value.level || null,
    title: value.title || null,
    message: value.message || null,
    details: value.details || value
  };

  logger.warn({ auditEventId, ...details }, "Received WhatsApp account alert");

  return {
    processed: 1,
    ignored: 0,
    accountAlert: details
  };
}

module.exports = {
  handleAccountAlerts
};
