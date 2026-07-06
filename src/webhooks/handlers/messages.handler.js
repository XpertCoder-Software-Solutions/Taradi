const logger = require("../../config/logger");
const { processInboundMessage } = require("../../services/webhook.service");

const knownMessageTypes = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "interactive",
  "button",
  "contacts",
  "location",
  "reaction"
]);

async function handleMessages({ value, auditEventId, field, entry }) {
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const results = [];
  let processed = 0;
  let ignored = 0;

  for (const message of messages) {
    if (!message) {
      logger.info({
        auditEventId,
        whatsappMessageId: null,
        messageType: null
      }, "Ignoring empty inbound WhatsApp message");
      logger.debugStep("Decision: ignoring empty inbound WhatsApp message", {
        webhookEventId: auditEventId,
        webhookField: field || "messages",
        entryId: entry && entry.id ? entry.id : null
      });

      results.push({
        whatsappMessageId: null,
        type: null,
        ignored: true,
        reason: "empty_message"
      });
      ignored += 1;
      continue;
    }

    if (!knownMessageTypes.has(message.type)) {
      logger.info({
        auditEventId,
        whatsappMessageId: message.id,
        messageType: message.type
      }, "Processing unknown inbound WhatsApp message type");
    }

    const result = await processInboundMessage(message, contacts, {
      auditEventId,
      webhookEventId: auditEventId,
      webhookField: field || "messages",
      eventType: "messages",
      entryId: entry && entry.id ? entry.id : null
    });
    results.push(result);

    if (result.ignored || result.duplicate) {
      ignored += 1;
    } else {
      processed += 1;
    }
  }

  return {
    processed,
    ignored,
    inboundMessages: results
  };
}

module.exports = {
  handleMessages
};
