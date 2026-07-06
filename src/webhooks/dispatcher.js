const prisma = require("../config/prisma");
const logger = require("../config/logger");
const { handleMessages } = require("./handlers/messages.handler");
const { handleMessageStatuses } = require("./handlers/messageStatus.handler");
const { handleTemplateStatus } = require("./handlers/templateStatus.handler");
const { handleTemplateQuality } = require("./handlers/templateQuality.handler");
const { handleTemplateComponents } = require("./handlers/templateComponents.handler");
const { handlePhoneNumberQuality } = require("./handlers/phoneNumberQuality.handler");
const { handleAccountAlerts } = require("./handlers/accountAlerts.handler");
const { handleCalls } = require("./handlers/calls.handler");
const { handleUnknown } = require("./handlers/unknown.handler");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getWebhookChanges(payload) {
  const entries = isObject(payload) && Array.isArray(payload.entry) ? payload.entry : [];
  const changes = [];

  for (const entry of entries) {
    const safeEntry = isObject(entry) ? entry : {};
    const entryChanges = Array.isArray(safeEntry.changes) ? safeEntry.changes : [];

    for (const change of entryChanges) {
      const safeChange = isObject(change) ? change : {};

      changes.push({
        entry: safeEntry,
        change: safeChange,
        field: safeChange.field || "unknown",
        value: isObject(safeChange.value) ? safeChange.value : {}
      });
    }
  }

  return changes;
}

function detectMessagesEventType(value) {
  const hasInboundMessages = Array.isArray(value.messages) && value.messages.length > 0;
  const hasStatuses = Array.isArray(value.statuses) && value.statuses.length > 0;

  if (hasStatuses && !hasInboundMessages) {
    return "message_status";
  }

  if (hasInboundMessages) {
    return "messages";
  }

  return "messages";
}

function detectWebhookEventType(payload) {
  const changes = getWebhookChanges(payload);

  if (changes.length === 0) {
    return "unknown";
  }

  const first = changes[0];

  if (first.field === "messages") {
    return detectMessagesEventType(first.value);
  }

  return first.field || "unknown";
}

function extractWhatsappMessageId(payload) {
  const changes = getWebhookChanges(payload);

  for (const { value } of changes) {
    const messages = Array.isArray(value.messages) ? value.messages : [];
    const statuses = Array.isArray(value.statuses) ? value.statuses : [];

    if (messages[0] && messages[0].id) {
      return messages[0].id;
    }

    if (statuses[0] && statuses[0].id) {
      return statuses[0].id;
    }
  }

  return null;
}

function createEmptySummary() {
  return {
    eventTypes: [],
    inboundMessages: [],
    statuses: [],
    templateStatus: [],
    templateQuality: [],
    templateComponents: [],
    phoneNumberQuality: [],
    accountAlerts: [],
    calls: [],
    unknown: [],
    ignored: [],
    processedCount: 0,
    ignoredCount: 0
  };
}

function mergeHandlerResult(summary, eventType, result) {
  summary.eventTypes.push(eventType);
  summary.processedCount += result.processed || 0;
  summary.ignoredCount += result.ignored || 0;

  if (result.inboundMessages) {
    summary.inboundMessages.push(...result.inboundMessages);
  }

  if (result.statuses) {
    summary.statuses.push(...result.statuses);
  }

  if (result.templateStatus) {
    summary.templateStatus.push(result.templateStatus);
  }

  if (result.templateQuality) {
    summary.templateQuality.push(result.templateQuality);
  }

  if (result.templateComponents) {
    summary.templateComponents.push(result.templateComponents);
  }

  if (result.phoneNumberQuality) {
    summary.phoneNumberQuality.push(result.phoneNumberQuality);
  }

  if (result.accountAlert) {
    summary.accountAlerts.push(result.accountAlert);
  }

  if (result.calls) {
    summary.calls.push(result.calls);
  }

  if (result.unknown) {
    summary.unknown.push(result.unknown);
  }
}

async function handleChange(changeContext, auditEventId) {
  const context = {
    ...changeContext,
    auditEventId
  };

  switch (changeContext.field) {
    case "messages": {
      const results = [];

      if (Array.isArray(changeContext.value.messages) && changeContext.value.messages.length > 0) {
        results.push({
          eventType: "messages",
          result: await handleMessages(context)
        });
      }

      if (Array.isArray(changeContext.value.statuses) && changeContext.value.statuses.length > 0) {
        results.push({
          eventType: "message_status",
          result: await handleMessageStatuses(context)
        });
      }

      if (results.length === 0) {
        results.push({
          eventType: "messages",
          result: await handleUnknown({ ...context, field: "messages" })
        });
      }

      return results;
    }
    case "message_template_status_update":
      return [{ eventType: changeContext.field, result: await handleTemplateStatus(context) }];
    case "message_template_quality_update":
      return [{ eventType: changeContext.field, result: await handleTemplateQuality(context) }];
    case "message_template_components_update":
      return [{ eventType: changeContext.field, result: await handleTemplateComponents(context) }];
    case "phone_number_quality_update":
      return [{ eventType: changeContext.field, result: await handlePhoneNumberQuality(context) }];
    case "account_alerts":
      return [{ eventType: changeContext.field, result: await handleAccountAlerts(context) }];
    case "calls":
      return [{ eventType: changeContext.field, result: await handleCalls(context) }];
    default:
      return [{ eventType: "unknown", result: await handleUnknown(context) }];
  }
}

async function updateAuditEvent(auditEventId, status, errorMessage) {
  const updated = await prisma.webhookEvent.update({
    where: { id: auditEventId },
    data: {
      status,
      errorMessage: errorMessage || null,
      processedAt: new Date()
    }
  });

  logger.debugStep("Updated WebhookEvent:", {
    webhookEventId: updated.id,
    status: updated.status,
    errorMessage: updated.errorMessage,
    processedAt: updated.processedAt
  });
}

async function dispatchWebhook(payload, auditEventId) {
  const summary = createEmptySummary();
  const changes = getWebhookChanges(payload);

  try {
    if (changes.length === 0) {
      const result = await handleUnknown({ field: "unknown", value: {}, auditEventId });
      mergeHandlerResult(summary, "unknown", result);
    }

    for (const changeContext of changes) {
      const results = await handleChange(changeContext, auditEventId);

      for (const { eventType, result } of results) {
        mergeHandlerResult(summary, eventType, result);
      }
    }

    const finalStatus = summary.processedCount > 0 ? "PROCESSED" : "IGNORED";
    await updateAuditEvent(auditEventId, finalStatus);

    logger.info({
      auditEventId,
      status: finalStatus,
      eventTypes: [...new Set(summary.eventTypes)],
      processedCount: summary.processedCount,
      ignoredCount: summary.ignoredCount
    }, "Webhook event dispatched");

    return {
      ...summary,
      status: finalStatus
    };
  } catch (error) {
    await updateAuditEvent(auditEventId, "FAILED", error.message);

    logger.error({ err: error, auditEventId }, "Webhook dispatch failed");

    return {
      ...summary,
      status: "FAILED",
      error: error.message
    };
  }
}

module.exports = {
  dispatchWebhook,
  detectWebhookEventType,
  extractWhatsappMessageId,
  getWebhookChanges
};
