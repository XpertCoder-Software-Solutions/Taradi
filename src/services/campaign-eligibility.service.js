const prisma = require("../config/prisma");
const { safeNormalizePhone } = require("../utils/normalizePhone");
const { getCampaignSettings, getPhoneSafety } = require("./campaign-settings.service");

function daysAgo(days, now = new Date()) {
  return new Date(now.getTime() - Number(days) * 24 * 60 * 60 * 1000);
}

function frequencyReasons({ recentCustomerMessages, maximum30Days, recentTemplateMessage, lastCampaignMessageAt, customerCooldownDays, now = new Date() }) {
  const reasons = [];
  if (recentCustomerMessages >= Number(maximum30Days)) reasons.push("CUSTOMER_30_DAY_FREQUENCY_CAP");
  if (recentTemplateMessage) reasons.push("TEMPLATE_COOLDOWN");
  if (lastCampaignMessageAt && lastCampaignMessageAt >= daysAgo(customerCooldownDays, now)) reasons.push("CUSTOMER_COOLDOWN");
  return reasons;
}

async function evaluateCampaignEligibility({ campaign, customer, template, baseEvaluation, duplicate = false, now = new Date() }) {
  const settings = await getCampaignSettings();
  const reasons = [...(baseEvaluation && baseEvaluation.reasons || [])];
  const phone = safeNormalizePhone((baseEvaluation && baseEvaluation.customer && (baseEvaluation.customer.primaryPhone || baseEvaluation.customer.phone)) || customer.phone);

  if (!phone || phone.length < 6) reasons.push("INVALID_PHONE");
  if (settings.CAMPAIGN_REQUIRE_OPT_IN && !customer.whatsappOptIn) reasons.push("OPT_IN_REQUIRED");
  if (customer.whatsappOptOutAt) reasons.push("CUSTOMER_OPTED_OUT");
  if (customer.whatsappSuppressed) reasons.push("CUSTOMER_SUPPRESSED");
  if (!template || template.status !== "APPROVED" || template.isActive === false) reasons.push("TEMPLATE_NOT_APPROVED_OR_ACTIVE");
  if (duplicate) reasons.push("DUPLICATE_RECIPIENT");

  if (phone) {
    const globallySuppressed = await prisma.globalWhatsappSuppression.findUnique({
      where: { normalizedPhone: phone }, select: { id: true }
    });
    if (globallySuppressed) reasons.push("GLOBAL_SUPPRESSION");
  }

  const phoneState = await getPhoneSafety(campaign.phoneNumberId);
  if (!phoneState.campaignsEnabled) reasons.push("PHONE_CAMPAIGNS_DISABLED");
  if (["RESTRICTED", "DISABLED", "BANNED"].includes(phoneState.accountStatus)) {
    reasons.push(`PHONE_ACCOUNT_${phoneState.accountStatus}`);
  }

  const [recentCustomerMessages, recentTemplateMessage] = await Promise.all([
    prisma.message.count({
      where: {
        customerId: customer.id,
        campaignId: { not: null },
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: daysAgo(30, now) }
      }
    }),
    prisma.message.findFirst({
      where: {
        customerId: customer.id,
        campaignId: { not: null },
        templateName: template.name,
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: daysAgo(settings.CAMPAIGN_TEMPLATE_COOLDOWN_DAYS, now) }
      },
      select: { id: true }
    })
  ]);

  reasons.push(...frequencyReasons({
    recentCustomerMessages,
    maximum30Days: settings.CAMPAIGN_MAX_MESSAGES_PER_CUSTOMER_30_DAYS,
    recentTemplateMessage,
    lastCampaignMessageAt: customer.lastCampaignMessageAt,
    customerCooldownDays: settings.CAMPAIGN_CUSTOMER_COOLDOWN_DAYS,
    now
  }));

  const uniqueReasons = [...new Set(reasons.filter(Boolean))];
  return { eligible: uniqueReasons.length === 0, reasons: uniqueReasons, phone, settings, phoneState };
}

module.exports = { evaluateCampaignEligibility, frequencyReasons, _daysAgoForTests: daysAgo };
