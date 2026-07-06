const logger = require("../../config/logger");

async function handleTemplateQuality({ value, auditEventId }) {
  const details = {
    templateName: value.message_template_name || value.template_name || value.name || null,
    language: value.message_template_language || value.language || value.language_code || null,
    qualityRating: value.new_quality_score || value.quality_rating || value.quality_score || null,
    previousQuality: value.previous_quality_score || value.previous_quality_rating || null,
    reason: value.reason || null
  };

  logger.info({ auditEventId, ...details }, "Received WhatsApp template quality update");

  return {
    processed: 1,
    ignored: 0,
    templateQuality: details
  };
}

module.exports = {
  handleTemplateQuality
};
