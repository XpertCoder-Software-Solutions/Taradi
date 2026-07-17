const logger = require("../../config/logger");
const prisma = require("../../config/prisma");

async function handlePhoneNumberQuality({ value, auditEventId }) {
  const details = {
    phoneNumberId: value.phone_number_id || value.metadata && value.metadata.phone_number_id || null,
    displayPhoneNumber: value.display_phone_number || value.metadata && value.metadata.display_phone_number || null,
    qualityRating: value.quality_rating || value.current_quality_rating || null,
    previousQuality: value.previous_quality_rating || null,
    currentMessagingLimit: value.current_limit || value.messaging_limit || value.current_messaging_limit || null
  };

  logger.info({ auditEventId, ...details }, "Received WhatsApp phone number quality update");

  const quality = String(details.qualityRating || "UNKNOWN").toUpperCase();
  if (details.phoneNumberId && ["UNKNOWN", "GREEN", "YELLOW", "RED", "LOW"].includes(quality)) {
    await prisma.whatsappPhoneNumber.upsert({
      where: { phoneNumberId: details.phoneNumberId },
      update: { displayPhoneNumber: details.displayPhoneNumber, qualityStatus: quality, lastStatusCheckAt: new Date() },
      create: { phoneNumberId: details.phoneNumberId, displayPhoneNumber: details.displayPhoneNumber, qualityStatus: quality, lastStatusCheckAt: new Date() }
    });
  }

  return {
    processed: 1,
    ignored: 0,
    phoneNumberQuality: details
  };
}

module.exports = {
  handlePhoneNumberQuality
};
