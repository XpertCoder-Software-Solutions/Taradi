const { z } = require("zod");
const permissionService = require("../services/permission.service");
const asyncHandler = require("../utils/asyncHandler");
const parse = require("../utils/validation");
const prisma = require("../config/prisma");
const { getCampaignSettings, ensureWhatsappPhoneNumber } = require("../services/campaign-settings.service");
const { recordCampaignAudit } = require("../services/campaign-audit.service");

const updatePermissionsSchema = z.object({
  role: z.enum(["SUPERVISOR", "EMPLOYEE"]),
  permissions: z.record(z.boolean())
});

const getPermissions = asyncHandler(async (req, res) => {
  const matrix = await permissionService.getPermissionMatrix();
  res.success(matrix);
});

const updatePermissions = asyncHandler(async (req, res) => {
  const data = parse(updatePermissionsSchema, req.body);
  const matrix = await permissionService.updateRolePermissions(data.role, data.permissions);

  res.success(matrix);
});

const campaignSafetySchema = z.object({
  settings: z.record(z.union([z.number(), z.boolean()])).optional(),
  phone: z.object({
    phoneNumberId: z.string().trim().min(1),
    displayPhoneNumber: z.string().trim().nullable().optional(),
    campaignsEnabled: z.boolean().optional(),
    accountStatus: z.enum(["UNKNOWN", "ACTIVE", "RESTRICTED", "DISABLED", "BANNED"]).optional(),
    qualityStatus: z.enum(["UNKNOWN", "GREEN", "YELLOW", "RED", "LOW"]).optional(),
    disabledReason: z.string().trim().nullable().optional(),
    maxCampaignMessagesPerMinute: z.number().int().positive().nullable().optional(),
    campaignBatchSize: z.number().int().positive().nullable().optional(),
    campaignBatchDelayMs: z.number().int().nonnegative().nullable().optional()
  }).optional()
});

const getCampaignSafety = asyncHandler(async (req, res) => {
  const [settings, phones] = await Promise.all([getCampaignSettings(), prisma.whatsappPhoneNumber.findMany({ orderBy: { createdAt: "asc" } })]);
  res.success({ settings, phones });
});

const updateCampaignSafety = asyncHandler(async (req, res) => {
  const data = parse(campaignSafetySchema, req.body);
  if (data.settings) {
    for (const [key, value] of Object.entries(data.settings)) {
      if (!key.startsWith("CAMPAIGN_")) continue;
      await prisma.applicationSetting.upsert({
        where: { key }, update: { value, updatedById: req.user.id }, create: { key, value, updatedById: req.user.id }
      });
      await recordCampaignAudit({ action: "CAMPAIGN_RATE_SETTING_CHANGED", actorId: req.user.id, newValue: { key, value } });
    }
  }
  if (data.phone) {
    await ensureWhatsappPhoneNumber(data.phone.phoneNumberId);
    const oldPhone = await prisma.whatsappPhoneNumber.findUnique({ where: { phoneNumberId: data.phone.phoneNumberId } });
    const phone = await prisma.whatsappPhoneNumber.update({
      where: { phoneNumberId: data.phone.phoneNumberId },
      data: { ...data.phone, phoneNumberId: undefined, lastStatusCheckAt: new Date() }
    });
    if (!phone.campaignsEnabled || ["DISABLED", "BANNED", "RESTRICTED"].includes(phone.accountStatus)) {
      await prisma.campaign.updateMany({
        where: { phoneNumberId: phone.phoneNumberId, status: { in: ["SCHEDULED", "RUNNING"] } },
        data: { status: "PAUSED", pausedAt: new Date(), pauseReason: phone.disabledReason || `Phone account ${phone.accountStatus}` }
      });
    }
    await recordCampaignAudit({ action: "PHONE_SAFETY_STATE_CHANGED", actorId: req.user.id, oldValue: oldPhone, newValue: phone, reason: phone.disabledReason });
  }
  const [settings, phones] = await Promise.all([getCampaignSettings(), prisma.whatsappPhoneNumber.findMany({ orderBy: { createdAt: "asc" } })]);
  res.success({ settings, phones });
});

module.exports = {
  getPermissions,
  updatePermissions
  ,getCampaignSafety
  ,updateCampaignSafety
};
