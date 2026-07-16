const prisma = require("../config/prisma");
const logger = require("../config/logger");
const { dispatchWebhook } = require("../webhooks/dispatcher");

const terminalStatuses = new Set(["PROCESSED", "IGNORED"]);
const retryablePrismaCodes = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024"
]);
const retryableSystemCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN"
]);

function isRetryableWebhookError(error) {
  if (!error) {
    return false;
  }

  if (retryablePrismaCodes.has(error.code) || retryableSystemCodes.has(error.code)) {
    return true;
  }

  const status = Number(error.status || error.statusCode);
  if (Number.isInteger(status) && (status === 408 || status === 429 || status >= 500)) {
    return true;
  }

  const message = String(error.message || "").toLowerCase();
  return [
    "timeout",
    "timed out",
    "connection",
    "temporarily",
    "transient",
    "deadlock",
    "too many connections",
    "database is starting"
  ].some((needle) => message.includes(needle));
}

function shouldRetryWebhookError(error, options = {}) {
  const attempts = Number(options.attempts || 1);
  const attemptsMade = Number(options.attemptsMade || 0);

  return attemptsMade + 1 < attempts && isRetryableWebhookError(error);
}

async function processQueuedWebhookEvent(auditEventId, options = {}) {
  if (!auditEventId || typeof auditEventId !== "string") {
    throw new Error("A string auditEventId is required");
  }

  const auditEvent = await prisma.webhookEvent.findUnique({
    where: { id: auditEventId },
    select: {
      id: true,
      eventType: true,
      whatsappMessageId: true,
      payload: true,
      status: true
    }
  });

  if (!auditEvent) {
    logger.warn({ auditEventId }, "Queued webhook event was not found");
    return { auditEventId, status: "NOT_FOUND" };
  }

  if (terminalStatuses.has(auditEvent.status)) {
    logger.info({
      auditEventId,
      status: auditEvent.status,
      eventType: auditEvent.eventType,
      whatsappMessageId: auditEvent.whatsappMessageId || null
    }, "Queued webhook event already processed");

    return {
      auditEventId,
      status: auditEvent.status,
      skipped: true
    };
  }

  try {
    const summary = await dispatchWebhook(auditEvent.payload, auditEvent.id, {
      throwOnError: true
    });

    return {
      auditEventId,
      status: summary.status,
      summary
    };
  } catch (error) {
    if (shouldRetryWebhookError(error, options)) {
      logger.warn({
        err: error,
        auditEventId,
        eventType: auditEvent.eventType,
        whatsappMessageId: auditEvent.whatsappMessageId || null,
        attemptsMade: options.attemptsMade || 0,
        attempts: options.attempts || 1,
        jobId: options.jobId || null
      }, "Queued webhook event failed with retryable error");

      throw error;
    }

    logger.error({
      err: error,
      auditEventId,
      eventType: auditEvent.eventType,
      whatsappMessageId: auditEvent.whatsappMessageId || null
    }, "Queued webhook event failed permanently");

    return {
      auditEventId,
      status: "FAILED",
      error: error.message
    };
  }
}

module.exports = {
  isRetryableWebhookError,
  shouldRetryWebhookError,
  processQueuedWebhookEvent
};
