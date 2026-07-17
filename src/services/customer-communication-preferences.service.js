const prisma = require("../config/prisma");
const ApiError = require("../utils/apiError");
const { recordCampaignAudit } = require("./campaign-audit.service");
const { safePublishRealtimeEvent } = require("../realtime/eventBus");

const OPT_OUT_PHRASES = new Set([
  "الغاء", "إلغاء", "توقف", "قف", "لا ترسل", "وقف الرسائل",
  "stop", "unsubscribe", "cancel", "opt out"
]);

function normalizePhrase(value) {
  return String(value || "").trim().toLowerCase().replace(/[.!،؟?\s]+/g, " ").trim();
}

function isOptOutPhrase(value) {
  return OPT_OUT_PHRASES.has(normalizePhrase(value));
}

async function publishPreferenceUpdate(customer) {
  return safePublishRealtimeEvent({
    event: "customer:communication_preferences",
    rooms: ["admins", `customer:${customer.id}`],
    payload: { customerId: customer.id, whatsappOptIn: customer.whatsappOptIn, whatsappOptOutAt: customer.whatsappOptOutAt, whatsappSuppressed: customer.whatsappSuppressed }
  });
}

async function applyInboundOptOut(customerId, inboundMessageId, phrase) {
  const now = new Date();
  const reason = `Inbound opt-out: ${normalizePhrase(phrase)}`;
  const customer = await prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({
      where: { id: customerId },
      data: {
        whatsappOptIn: false,
        whatsappOptOutAt: now,
        whatsappOptOutReason: reason,
        whatsappOptOutMessageId: inboundMessageId,
        whatsappSuppressed: true,
        whatsappSuppressionReason: reason
      }
    });
    await tx.campaignRecipient.updateMany({
      where: { customerId, status: { in: ["PENDING", "QUEUED"] } },
      data: { status: "CANCELLED", skipReason: "CUSTOMER_OPTED_OUT" }
    });
    return updated;
  });
  await recordCampaignAudit({ action: "CUSTOMER_OPTED_OUT", customerId, newValue: { whatsappOptOutAt: now, whatsappSuppressed: true, inboundMessageId }, reason });
  await publishPreferenceUpdate(customer);
  return customer;
}

async function updatePreferences(customerId, actor, data) {
  if (!actor || actor.role !== "ADMIN") throw new ApiError(403, "Administrator access is required");
  const current = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!current) throw new ApiError(404, "Customer not found");
  const optingIn = data.whatsappOptIn === true;
  if (optingIn && (!data.source || !data.optInAt)) throw new ApiError(400, "Opt-in source and timestamp are required");
  const timestamp = optingIn ? new Date(data.optInAt) : new Date();
  if (Number.isNaN(timestamp.getTime())) throw new ApiError(400, "Invalid opt-in timestamp");
  const update = optingIn ? {
    whatsappOptIn: true,
    whatsappOptInAt: timestamp,
    whatsappOptInSource: data.source,
    whatsappOptOutAt: null,
    whatsappOptOutReason: null,
    whatsappOptOutMessageId: null,
    whatsappSuppressed: false,
    whatsappSuppressionReason: null
  } : {
    whatsappOptIn: false,
    whatsappOptOutAt: timestamp,
    whatsappOptOutReason: data.reason || "Manual admin opt-out",
    whatsappSuppressed: true,
    whatsappSuppressionReason: data.reason || "Manual admin opt-out"
  };
  const customer = await prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id: customerId }, data: update });
    if (!optingIn) {
      await tx.campaignRecipient.updateMany({ where: { customerId, status: { in: ["PENDING", "QUEUED"] } }, data: { status: "CANCELLED", skipReason: "ADMIN_OPT_OUT" } });
    }
    return updated;
  });
  await recordCampaignAudit({
    action: optingIn ? "CUSTOMER_MANUAL_OPT_IN" : "CUSTOMER_MANUAL_OPT_OUT",
    actorId: actor.id,
    customerId,
    oldValue: { whatsappOptIn: current.whatsappOptIn, whatsappOptOutAt: current.whatsappOptOutAt, whatsappSuppressed: current.whatsappSuppressed },
    newValue: update,
    reason: data.reason || data.source
  });
  await publishPreferenceUpdate(customer);
  return customer;
}

module.exports = { OPT_OUT_PHRASES, normalizePhrase, isOptOutPhrase, applyInboundOptOut, updatePreferences };
