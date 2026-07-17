const prisma = require("../config/prisma");
const env = require("../config/env");
const logger = require("../config/logger");
const whatsapp = require("./whatsapp.service");
const { classifyCampaignError, retryDelayMs } = require("./campaign-error.service");
const { getCampaignSettings } = require("./campaign-settings.service");
const { recordCampaignAudit } = require("./campaign-audit.service");

const terminalRecipientStatuses = ["SENT", "DELIVERED", "READ", "FAILED", "SKIPPED", "CANCELLED"];

function autoPauseReason({ sampled, failed, recentStatuses, minSample, failureRatePercent, consecutiveFailures }) {
  if (recentStatuses.length >= Number(consecutiveFailures) && recentStatuses.slice(0, Number(consecutiveFailures)).every((status) => status === "FAILED")) {
    return `Consecutive campaign failures reached ${consecutiveFailures}`;
  }
  const failureRate = sampled ? failed * 100 / sampled : 0;
  if (sampled >= Number(minSample) && failureRate >= Number(failureRatePercent)) {
    return `Campaign failure rate ${failureRate.toFixed(1)}% exceeded the safety threshold`;
  }
  return null;
}

async function refreshCampaignRecipientCounts(campaignId) {
  const grouped = await prisma.campaignRecipient.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
  const count = (status) => grouped.find((row) => row.status === status)?._count._all || 0;
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return null;
  const pendingCount = count("PENDING");
  const queuedCount = count("QUEUED");
  const processingCount = count("PROCESSING");
  const failedCount = count("FAILED");
  const complete = pendingCount + queuedCount + processingCount === 0;
  const status = complete && ["RUNNING", "SCHEDULED"].includes(campaign.status) ? "COMPLETED" : campaign.status;
  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status,
      pendingCount,
      queuedCount,
      sentCount: count("SENT"),
      deliveredCount: count("DELIVERED"),
      readCount: count("READ"),
      failedCount,
      skippedCount: count("SKIPPED"),
      completedAt: status === "COMPLETED" ? campaign.completedAt || new Date() : campaign.completedAt
    }
  });
  if (status === "COMPLETED" && campaign.status !== "COMPLETED") {
    await recordCampaignAudit({ action: "CAMPAIGN_COMPLETED", campaignId, newValue: { status, failedCount } });
  }
  return updated;
}

async function pauseCampaign(campaignId, reason, automatic = true) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || !["RUNNING", "SCHEDULED"].includes(campaign.status)) return campaign;
  const updated = await prisma.campaign.update({
    where: { id: campaignId }, data: { status: "PAUSED", pausedAt: new Date(), pauseReason: reason, error: reason }
  });
  await recordCampaignAudit({ action: automatic ? "CAMPAIGN_AUTO_PAUSED" : "CAMPAIGN_PAUSED", campaignId, reason });
  return updated;
}

async function pausePhoneCampaigns(phoneNumberId, reason, category) {
  const campaigns = await prisma.campaign.findMany({
    where: { phoneNumberId, status: { in: ["SCHEDULED", "RUNNING"] } }, select: { id: true }
  });
  await prisma.$transaction([
    prisma.campaign.updateMany({
      where: { phoneNumberId, status: { in: ["SCHEDULED", "RUNNING"] } },
      data: { status: "PAUSED", pausedAt: new Date(), pauseReason: reason, error: reason }
    }),
    prisma.campaignAdminAlert.create({ data: { category, message: reason, phoneNumberId } })
    ,prisma.whatsappPhoneNumber.updateMany({
      where: { phoneNumberId },
      data: { accountStatus: "RESTRICTED", campaignsEnabled: false, disabledReason: reason, lastStatusCheckAt: new Date() }
    })
  ]);
  for (const campaign of campaigns) {
    await recordCampaignAudit({ action: "CAMPAIGN_AUTO_PAUSED", campaignId: campaign.id, reason });
  }
}

async function evaluateAutoPause(campaignId) {
  const settings = await getCampaignSettings();
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "RUNNING") return null;
  const sampled = await prisma.campaignRecipient.count({ where: { campaignId, status: { in: terminalRecipientStatuses } } });
  const failed = await prisma.campaignRecipient.count({ where: { campaignId, status: "FAILED" } });
  const recent = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] } },
    orderBy: { updatedAt: "desc" }, take: Number(settings.CAMPAIGN_AUTO_PAUSE_CONSECUTIVE_FAILURES), select: { status: true }
  });
  const reason = autoPauseReason({
    sampled,
    failed,
    recentStatuses: recent.map((row) => row.status),
    minSample: settings.CAMPAIGN_AUTO_PAUSE_MIN_SAMPLE,
    failureRatePercent: settings.CAMPAIGN_AUTO_PAUSE_FAILURE_RATE_PERCENT,
    consecutiveFailures: settings.CAMPAIGN_AUTO_PAUSE_CONSECUTIVE_FAILURES
  });
  if (reason) return pauseCampaign(campaignId, reason);
  return null;
}

function recipientComponents(recipient) {
  const value = recipient.resolvedTemplateParameters;
  if (value && !Array.isArray(value) && Array.isArray(value.components)) return value.components;
  return [];
}

async function processCampaignRecipient(campaignId, recipientId, options = {}) {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId }, include: { campaign: true, customer: { include: { phones: true } } }
  });
  if (!recipient || recipient.campaignId !== campaignId) return { status: "NOT_FOUND" };
  if (["SENT", "DELIVERED", "READ", "FAILED", "SKIPPED", "CANCELLED"].includes(recipient.status)) return { status: recipient.status, idempotent: true };
  if (!["SCHEDULED", "RUNNING"].includes(recipient.campaign.status)) {
    if (recipient.campaign.status === "CANCELLED") await prisma.campaignRecipient.update({ where: { id: recipientId }, data: { status: "CANCELLED" } });
    else await prisma.campaignRecipient.updateMany({ where: { id: recipientId, status: "QUEUED" }, data: { status: "PENDING" } });
    return { status: recipient.campaign.status };
  }

  const claimed = await prisma.campaignRecipient.updateMany({
    where: { id: recipientId, status: "QUEUED", whatsappMessageId: null },
    data: { status: "PROCESSING", attemptCount: { increment: 1 }, errorMessage: null }
  });
  if (!claimed.count) return { status: recipient.status, idempotent: true };

  const freshCampaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  if (!freshCampaign || freshCampaign.status !== "RUNNING") {
    await prisma.campaignRecipient.update({ where: { id: recipientId }, data: { status: freshCampaign && freshCampaign.status === "CANCELLED" ? "CANCELLED" : "PENDING" } });
    return { status: freshCampaign && freshCampaign.status || "NOT_FOUND" };
  }

  try {
    const response = await whatsapp.sendTemplateMessage(
      recipient.phoneSnapshot,
      recipient.campaign.templateName,
      recipient.campaign.languageCode,
      recipientComponents(recipient)
    );
    const whatsappMessageId = whatsapp.extractMessageId(response);
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          customerId: recipient.customerId,
          debtId: recipient.debtId,
          campaignId,
          direction: "OUTBOUND",
          type: "TEMPLATE",
          content: recipient.campaign.templateName,
          body: recipient.campaign.templateName,
          templateName: recipient.campaign.templateName,
          whatsappMessageId: whatsappMessageId || null,
          status: "SENT",
          sentByUserId: recipient.campaign.createdById,
          rawPayload: { campaignRecipientId: recipient.id, metaResponse: response },
          statusUpdatedAt: now
        }
      });
      await tx.campaignRecipient.update({
        where: { id: recipientId },
        data: { status: "SENT", sendStatus: "SENT", sentAt: now, whatsappMessageId: whatsappMessageId || null, messageId: message.id, errorCategory: null, errorMessage: null }
      });
      await tx.customer.update({
        where: { id: recipient.customerId }, data: { lastCampaignMessageAt: now, campaignMessageCount: { increment: 1 } }
      });
      return message;
    });
    await refreshCampaignRecipientCounts(campaignId);
    return { status: "SENT", messageId: result.id, whatsappMessageId };
  } catch (error) {
    const classified = classifyCampaignError(error);
    const attempt = Number(recipient.attemptCount || 0) + 1;
    if (classified.retryable && attempt < Number(options.attempts || env.CAMPAIGN_SEND_ATTEMPTS)) {
      const delayMs = retryDelayMs(attempt, classified.retryAfterMs);
      await prisma.campaignRecipient.update({
        where: { id: recipientId }, data: { status: "QUEUED", nextAttemptAt: new Date(Date.now() + delayMs), errorCategory: classified.category, errorMessage: classified.message }
      });
      return { status: "RETRY", delayMs, error: classified.message };
    }
    await prisma.campaignRecipient.update({
      where: { id: recipientId }, data: { status: "FAILED", sendStatus: "FAILED", failedAt: new Date(), errorCategory: classified.category, errorMessage: classified.message }
    });
    if (["AUTHENTICATION", "PERMANENT_ACCOUNT"].includes(classified.category)) {
      await pausePhoneCampaigns(recipient.campaign.phoneNumberId, classified.message, classified.category);
    } else if (classified.category === "PERMANENT_TEMPLATE") {
      await pauseCampaign(campaignId, classified.message);
    } else {
      await evaluateAutoPause(campaignId);
    }
    await refreshCampaignRecipientCounts(campaignId);
    logger.error({ err: error, campaignId, recipientId, category: classified.category }, "Campaign recipient failed");
    return { status: "FAILED", category: classified.category, error: classified.message };
  }
}

module.exports = { processCampaignRecipient, refreshCampaignRecipientCounts, evaluateAutoPause, pauseCampaign, pausePhoneCampaigns, autoPauseReason };
