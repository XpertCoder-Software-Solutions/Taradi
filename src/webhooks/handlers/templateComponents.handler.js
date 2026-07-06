const logger = require("../../config/logger");

async function handleTemplateComponents({ value, auditEventId }) {
  const details = {
    templateName: value.message_template_name || value.template_name || value.name || null,
    language: value.message_template_language || value.language || value.language_code || null,
    changedComponents: value.components || value.changed_components || [],
    reason: value.reason || null
  };

  logger.info({ auditEventId, ...details }, "Received WhatsApp template components update");

  return {
    processed: 1,
    ignored: 0,
    templateComponents: details
  };
}

module.exports = {
  handleTemplateComponents
};
