const prisma = require("../config/prisma");
const env = require("../config/env");
const logger = require("../config/logger");
const { createRedisConnection } = require("../config/redis");
const { enqueueCampaignRecipient } = require("../queues/campaign.queue");
const { recordCampaignAudit } = require("./campaign-audit.service");

let lockConnection;
function redis() {
  if (!lockConnection) lockConnection = createRedisConnection();
  return lockConnection;
}

async function withDispatchLock(campaignId, callback) {
  const key = `campaign:dispatch-lock:${campaignId}`;
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;
  const acquired = await redis().set(key, token, "PX", env.CAMPAIGN_DISPATCH_LOCK_MS, "NX");
  if (!acquired) return { locked: true };
  try {
    return await callback();
  } finally {
    const current = await redis().get(key);
    if (current === token) await redis().del(key);
  }
}

async function dispatchCampaign(campaignId) {
  return withDispatchLock(campaignId, async () => {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || !["SCHEDULED", "RUNNING"].includes(campaign.status)) return { skipped: true };

    const competitor = await prisma.campaign.findFirst({
      where: {
        id: { not: campaign.id },
        phoneNumberId: campaign.phoneNumberId,
        status: "RUNNING",
        startedAt: { lte: campaign.startedAt || new Date() }
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }]
    });
    if (competitor) return { competingCampaignId: competitor.id };

    const inFlight = await prisma.campaignRecipient.count({
      where: { campaignId, status: { in: ["QUEUED", "PROCESSING"] } }
    });
    if (inFlight > 0) return { inFlight };

    const batchSize = Math.min(campaign.batchSize || env.CAMPAIGN_BATCH_SIZE, env.CAMPAIGN_ADMIN_MAX_BATCH_SIZE);
    const recipients = await prisma.campaignRecipient.findMany({
      where: { campaignId, status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize
    });

    if (!recipients.length) return { empty: true };
    const latest = await prisma.campaignRecipient.findFirst({
      where: { campaignId, status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true }
    });
    const delayMs = latest && latest.updatedAt
      ? Math.max(0, (campaign.batchDelayMs || env.CAMPAIGN_BATCH_DELAY_MS) - (Date.now() - latest.updatedAt.getTime()))
      : 0;
    const now = new Date();

    const ratePerMinute = Math.max(1, Math.min(campaign.rateLimitPerMinute || env.CAMPAIGN_SEND_MAX, env.CAMPAIGN_SEND_MAX));
    const spacingMs = Math.ceil(60000 / ratePerMinute);
    for (const [index, recipient] of recipients.entries()) {
      try {
        await enqueueCampaignRecipient(campaign.id, recipient.id, { delay: delayMs + (index * spacingMs) });
        await prisma.campaignRecipient.updateMany({
          where: { id: recipient.id, status: "PENDING" }, data: { status: "QUEUED", queuedAt: now }
        });
      } catch (error) {
        logger.error({ err: error, campaignId, recipientId: recipient.id }, "Failed to queue campaign recipient");
      }
    }
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING", startedAt: campaign.startedAt || new Date() } });
    if (campaign.status === "SCHEDULED") {
      await recordCampaignAudit({ action: "CAMPAIGN_STARTED", actorId: campaign.createdById, campaignId, oldValue: { status: "SCHEDULED" }, newValue: { status: "RUNNING" } });
    }
    return { queued: recipients.length, delayMs };
  });
}

async function dispatchActiveCampaigns() {
  const campaigns = await prisma.campaign.findMany({
    where: { status: { in: ["SCHEDULED", "RUNNING"] } }, orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }]
  });
  const selectedPhones = new Set();
  for (const campaign of campaigns) {
    const phoneKey = campaign.phoneNumberId || env.WHATSAPP_PHONE_NUMBER_ID;
    if (selectedPhones.has(phoneKey)) continue;
    selectedPhones.add(phoneKey);
    await dispatchCampaign(campaign.id);
  }
  return campaigns.length;
}

async function closeCampaignDispatcher() {
  if (lockConnection && lockConnection.status !== "end") await lockConnection.quit();
  lockConnection = null;
}

module.exports = { dispatchCampaign, dispatchActiveCampaigns, closeCampaignDispatcher };
