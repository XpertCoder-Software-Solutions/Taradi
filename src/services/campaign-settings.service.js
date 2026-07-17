const prisma = require("../config/prisma");
const env = require("../config/env");

const settingEnvMap = {
  CAMPAIGN_SEND_MAX: "CAMPAIGN_SEND_MAX",
  CAMPAIGN_SEND_DURATION_MS: "CAMPAIGN_SEND_DURATION_MS",
  CAMPAIGN_BATCH_SIZE: "CAMPAIGN_BATCH_SIZE",
  CAMPAIGN_BATCH_DELAY_MS: "CAMPAIGN_BATCH_DELAY_MS",
  CAMPAIGN_MAX_ACTIVE_PER_PHONE: "CAMPAIGN_MAX_ACTIVE_PER_PHONE",
  CAMPAIGN_REQUIRE_OPT_IN: "CAMPAIGN_REQUIRE_OPT_IN",
  CAMPAIGN_CUSTOMER_COOLDOWN_DAYS: "CAMPAIGN_CUSTOMER_COOLDOWN_DAYS",
  CAMPAIGN_TEMPLATE_COOLDOWN_DAYS: "CAMPAIGN_TEMPLATE_COOLDOWN_DAYS",
  CAMPAIGN_MAX_MESSAGES_PER_CUSTOMER_30_DAYS: "CAMPAIGN_MAX_MESSAGES_PER_CUSTOMER_30_DAYS",
  CAMPAIGN_AUTO_PAUSE_MIN_SAMPLE: "CAMPAIGN_AUTO_PAUSE_MIN_SAMPLE",
  CAMPAIGN_AUTO_PAUSE_FAILURE_RATE_PERCENT: "CAMPAIGN_AUTO_PAUSE_FAILURE_RATE_PERCENT",
  CAMPAIGN_AUTO_PAUSE_CONSECUTIVE_FAILURES: "CAMPAIGN_AUTO_PAUSE_CONSECUTIVE_FAILURES",
  CAMPAIGN_AUTO_PAUSE_AUTH_ERRORS: "CAMPAIGN_AUTO_PAUSE_AUTH_ERRORS",
  CAMPAIGN_ADMIN_MAX_PER_MINUTE: "CAMPAIGN_ADMIN_MAX_PER_MINUTE",
  CAMPAIGN_ADMIN_MAX_BATCH_SIZE: "CAMPAIGN_ADMIN_MAX_BATCH_SIZE",
  CAMPAIGN_ADMIN_MIN_BATCH_DELAY_MS: "CAMPAIGN_ADMIN_MIN_BATCH_DELAY_MS"
};

function unwrapSetting(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "value")) {
    return value.value;
  }
  return value;
}

async function getCampaignSettings() {
  const keys = Object.keys(settingEnvMap);
  const rows = await prisma.applicationSetting.findMany({ where: { key: { in: keys } } });
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const result = {};

  for (const key of keys) {
    result[key] = unwrapSetting(stored.get(key), env[settingEnvMap[key]]);
  }

  return result;
}

async function ensureWhatsappPhoneNumber(phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID) {
  return prisma.whatsappPhoneNumber.upsert({
    where: { phoneNumberId },
    update: {},
    create: {
      phoneNumberId,
      campaignsEnabled: true,
      accountStatus: "UNKNOWN",
      qualityStatus: "UNKNOWN",
      maxCampaignMessagesPerMinute: env.CAMPAIGN_ADMIN_MAX_PER_MINUTE,
      campaignBatchSize: env.CAMPAIGN_ADMIN_MAX_BATCH_SIZE,
      campaignBatchDelayMs: env.CAMPAIGN_ADMIN_MIN_BATCH_DELAY_MS
    }
  });
}

async function getPhoneSafety(phoneNumberId) {
  return ensureWhatsappPhoneNumber(phoneNumberId || env.WHATSAPP_PHONE_NUMBER_ID);
}

module.exports = { getCampaignSettings, ensureWhatsappPhoneNumber, getPhoneSafety };
