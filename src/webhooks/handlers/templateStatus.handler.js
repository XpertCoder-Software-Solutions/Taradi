const logger = require("../../config/logger");

async function handleTemplateStatus({ value, auditEventId }) {
  const details = {
    templateName: value.message_template_name || value.template_name || value.name || null,
    language: value.message_template_language || value.language || value.language_code || null,
    status: value.event || value.status || null,
    reason: value.reason || value.rejection_reason || null
  };

  logger.info({ auditEventId, ...details }, "Received WhatsApp template status update");

  return {
    processed: 1,
    ignored: 0,
    templateStatus: details
  };
}

module.exports = {
  handleTemplateStatus
};
