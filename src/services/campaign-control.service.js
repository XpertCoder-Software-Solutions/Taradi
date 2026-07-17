const prisma = require("../config/prisma");
const env = require("../config/env");
const ApiError = require("../utils/apiError");
const { getCampaignSendQueue } = require("../queues/campaign.queue");
const { dispatchCampaign } = require("./campaign-dispatcher.service");
const { refreshCampaignRecipientCounts } = require("./campaign-send.service");
const { getCampaignSettings, getPhoneSafety } = require("./campaign-settings.service");
const { recordCampaignAudit } = require("./campaign-audit.service");

async function accessibleCampaign(user, id) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign || (user.role !== "ADMIN" && campaign.createdById !== user.id)) throw new ApiError(404, "Campaign not found");
  return campaign;
}

async function assertStartable(campaign) {
  const template = await prisma.whatsappTemplate.findUnique({ where: { id: campaign.templateId } });
  if (!template || template.status !== "APPROVED" || !template.isActive) throw new ApiError(400, "Campaign template is not approved and active");
  if (campaign.eligibleCount < 1) throw new ApiError(400, "Campaign has no eligible recipients");
  const phone = await getPhoneSafety(campaign.phoneNumberId || env.WHATSAPP_PHONE_NUMBER_ID);
  if (!phone.campaignsEnabled || ["RESTRICTED", "DISABLED", "BANNED"].includes(phone.accountStatus)) {
    throw new ApiError(409, phone.disabledReason || `WhatsApp phone account is ${phone.accountStatus}`);
  }
  const other = await prisma.campaign.findFirst({
    where: { id: { not: campaign.id }, phoneNumberId: campaign.phoneNumberId, status: { in: ["SCHEDULED", "RUNNING"] } }
  });
  if (other) throw new ApiError(409, "Another campaign is active for this WhatsApp phone number");
  const settings = await getCampaignSettings();
  if ((campaign.rateLimitPerMinute || 0) > Number(settings.CAMPAIGN_ADMIN_MAX_PER_MINUTE)) throw new ApiError(400, "Campaign send rate exceeds administrator maximum");
  if ((campaign.batchSize || 0) > Number(settings.CAMPAIGN_ADMIN_MAX_BATCH_SIZE)) throw new ApiError(400, "Campaign batch size exceeds administrator maximum");
  if ((campaign.batchDelayMs || 0) < Number(settings.CAMPAIGN_ADMIN_MIN_BATCH_DELAY_MS)) throw new ApiError(400, "Campaign batch delay is below administrator minimum");
}

async function startCampaign(user, id) {
  const campaign = await accessibleCampaign(user, id);
  if (!["READY", "SCHEDULED", "DRAFT"].includes(campaign.status)) throw new ApiError(409, `Campaign cannot start from ${campaign.status}`);
  await assertStartable(campaign);
  const updated = await prisma.campaign.update({
    where: { id }, data: { status: "RUNNING", startedAt: campaign.startedAt || new Date(), pausedAt: null, pauseReason: null, error: null }
  });
  await recordCampaignAudit({ action: "CAMPAIGN_STARTED", actorId: user.id, campaignId: id, oldValue: { status: campaign.status }, newValue: { status: "RUNNING" } });
  await dispatchCampaign(id);
  return updated;
}

async function pauseCampaign(user, id, reason) {
  const campaign = await accessibleCampaign(user, id);
  if (!["SCHEDULED", "RUNNING"].includes(campaign.status)) throw new ApiError(409, `Campaign cannot pause from ${campaign.status}`);
  const updated = await prisma.campaign.update({ where: { id }, data: { status: "PAUSED", pausedAt: new Date(), pauseReason: reason || "Paused by admin" } });
  await recordCampaignAudit({ action: "CAMPAIGN_PAUSED", actorId: user.id, campaignId: id, oldValue: { status: campaign.status }, newValue: { status: "PAUSED" }, reason });
  return updated;
}

async function resumeCampaign(user, id) {
  const campaign = await accessibleCampaign(user, id);
  if (campaign.status !== "PAUSED") throw new ApiError(409, `Campaign cannot resume from ${campaign.status}`);
  await assertStartable(campaign);
  await prisma.campaignRecipient.updateMany({ where: { campaignId: id, status: "QUEUED" }, data: { status: "PENDING" } });
  const updated = await prisma.campaign.update({ where: { id }, data: { status: "RUNNING", pausedAt: null, pauseReason: null, error: null } });
  await recordCampaignAudit({ action: "CAMPAIGN_RESUMED", actorId: user.id, campaignId: id, newValue: { status: "RUNNING" } });
  await dispatchCampaign(id);
  return updated;
}

async function cancelCampaign(user, id, reason) {
  const campaign = await accessibleCampaign(user, id);
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(campaign.status)) throw new ApiError(409, `Campaign cannot cancel from ${campaign.status}`);
  await prisma.$transaction([
    prisma.campaign.update({ where: { id }, data: { status: "CANCELLED", completedAt: new Date(), pauseReason: reason || null } }),
    prisma.campaignRecipient.updateMany({ where: { campaignId: id, status: { in: ["PENDING", "QUEUED"] } }, data: { status: "CANCELLED" } })
  ]);
  const jobs = await getCampaignSendQueue().getJobs(["delayed", "waiting", "prioritized"]);
  await Promise.all(jobs.filter((job) => String(job.id).startsWith(`campaign:${id}:recipient-`)).map((job) => job.remove().catch(() => null)));
  await recordCampaignAudit({ action: "CAMPAIGN_CANCELLED", actorId: user.id, campaignId: id, reason });
  return refreshCampaignRecipientCounts(id);
}

async function getProgress(user, id) {
  await accessibleCampaign(user, id);
  const campaign = await refreshCampaignRecipientCounts(id);
  const processing = await prisma.campaignRecipient.count({ where: { campaignId: id, status: "PROCESSING" } });
  const cancelled = await prisma.campaignRecipient.count({ where: { campaignId: id, status: "CANCELLED" } });
  return { ...campaign, processingCount: processing, cancelledCount: cancelled };
}

async function listRecipients(user, id, type, query = {}) {
  await accessibleCampaign(user, id);
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 25)));
  const where = { campaignId: id, ...(type === "skipped" ? { status: "SKIPPED" } : { status: "FAILED" }) };
  const [items, total] = await prisma.$transaction([
    prisma.campaignRecipient.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "asc" }, include: { customer: { select: { id: true, fullName: true, phone: true } } } }),
    prisma.campaignRecipient.count({ where })
  ]);
  return { items, meta: { page, limit, total } };
}

module.exports = { startCampaign, pauseCampaign, resumeCampaign, cancelCampaign, getProgress, listRecipients };
