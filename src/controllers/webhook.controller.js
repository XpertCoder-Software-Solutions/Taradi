const env = require("../config/env");
const logger = require("../config/logger");
const prisma = require("../config/prisma");
const {
  detectWebhookEventType,
  extractWhatsappMessageId,
  getWebhookChanges
} = require("../webhooks/dispatcher");
const { enqueueWebhookEvent } = require("../queues/webhook.queue");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");
const sanitizeHeaders = require("../utils/sanitizeHeaders");

function getDebugMessageText(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (message.text && message.text.body) {
    return message.text.body;
  }

  if (message.button && message.button.text) {
    return message.button.text;
  }

  if (message.interactive && message.interactive.button_reply) {
    return message.interactive.button_reply.title || null;
  }

  if (message.interactive && message.interactive.list_reply) {
    return message.interactive.list_reply.title || null;
  }

  if (message.image) {
    return message.image.caption || null;
  }

  if (message.document) {
    return message.document.caption || message.document.filename || null;
  }

  return null;
}

function getFirstWebhookDebugSnapshot(body) {
  const changes = getWebhookChanges(body);
  const firstChange = changes[0] || {};
  const value = firstChange.value || {};
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const statuses = Array.isArray(value.statuses) ? value.statuses : [];
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const message = messages[0] || {};
  const status = statuses[0] || {};
  const contact = contacts[0] || {};

  return {
    webhookField: firstChange.field || null,
    phoneNumber: message.from || contact.wa_id || null,
    whatsappMessageId: message.id || status.id || null,
    messageType: message.type || null,
    messageText: getDebugMessageText(message)
  };
}

function verifyWebhook(req, res, next) {
  const mode = req.query["hub.mode"];
  const receivedToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const envToken = env.WHATSAPP_VERIFY_TOKEN;
  const receivedTokenIsString = typeof receivedToken === "string";
  const envTokenIsString = typeof envToken === "string";
  const tokensMatch = receivedTokenIsString && envTokenIsString && receivedToken === envToken;

  logger.info({
    route: `${req.method || "GET"} ${req.baseUrl || ""}${req.path || ""}`,
    mode,
    envTokenExists: Boolean(envToken),
    receivedTokenLength: receivedTokenIsString ? receivedToken.length : null,
    envTokenLength: envTokenIsString ? envToken.length : null,
    receivedTokenType: Array.isArray(receivedToken) ? "array" : typeof receivedToken,
    envTokenType: typeof envToken,
    tokensMatch,
    hasReceivedLeadingOrTrailingWhitespace: receivedTokenIsString ? receivedToken !== receivedToken.trim() : null,
    hasEnvLeadingOrTrailingWhitespace: envTokenIsString ? envToken !== envToken.trim() : null
  }, "WhatsApp webhook verification attempt");

  if (mode === "subscribe" && tokensMatch) {
    return res.status(200).send(challenge);
  }

  return next(new ApiError(403, "Webhook verification failed"));
}

const receiveWebhook = asyncHandler(async (req, res) => {
  const eventType = detectWebhookEventType(req.body);
  const whatsappMessageId = extractWhatsappMessageId(req.body);
  const debugSnapshot = getFirstWebhookDebugSnapshot(req.body);
  const auditEvent = await prisma.webhookEvent.create({
    data: {
      provider: "WHATSAPP",
      eventType,
      whatsappMessageId,
      payload: req.body || {},
      headers: sanitizeHeaders(req.headers),
      status: "RECEIVED"
    }
  });

  logger.info({
    auditEventId: auditEvent.id,
    eventType,
    hasWhatsappMessageId: Boolean(whatsappMessageId)
  }, "Received WhatsApp webhook event");

  logger.debugStep("NEW WHATSAPP WEBHOOK", {
    timestamp: new Date().toISOString(),
    webhookField: debugSnapshot.webhookField,
    eventType,
    phoneNumber: debugSnapshot.phoneNumber,
    whatsappMessageId: debugSnapshot.whatsappMessageId || whatsappMessageId,
    messageType: debugSnapshot.messageType,
    messageText: debugSnapshot.messageText,
    customerFound: "PENDING",
    conversationFound: "PENDING",
    messageCreated: "PENDING",
    socketEmitted: "PENDING",
    webhookEventId: auditEvent.id
  });

  logger.debugStep("Created WebhookEvent:", {
    webhookEventId: auditEvent.id,
    eventType,
    whatsappMessageId,
    status: auditEvent.status
  });

  const job = await enqueueWebhookEvent(auditEvent.id, {
    eventType,
    whatsappMessageId,
    receivedAt: auditEvent.createdAt ? auditEvent.createdAt.toISOString() : new Date().toISOString()
  });

  res.success({
    auditEventId: auditEvent.id,
    eventType,
    queued: true,
    job: {
      id: job.id,
      queue: "whatsapp-webhook-processing"
    },
    summary: {
      status: "QUEUED"
    }
  });
});

module.exports = {
  verifyWebhook,
  receiveWebhook
};
