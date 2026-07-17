const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { classifyCampaignError } = require("../src/services/campaign-error.service");
const { frequencyReasons } = require("../src/services/campaign-eligibility.service");
const { autoPauseReason } = require("../src/services/campaign-send.service");
const { isOptOutPhrase } = require("../src/services/customer-communication-preferences.service");
const { campaignRecipientJobId } = require("../src/queues/campaign.queue");

const source = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("eligibility requires opt-in and stores suppressed/opted-out recipients as skipped", () => {
  const eligibility = source("src/services/campaign-eligibility.service.js");
  const preparation = source("src/services/message.service.js");
  assert.match(eligibility, /OPT_IN_REQUIRED/);
  assert.match(eligibility, /CUSTOMER_OPTED_OUT/);
  assert.match(eligibility, /CUSTOMER_SUPPRESSED/);
  assert.match(preparation, /status: eligibility\.eligible \? "PENDING" : "SKIPPED"/);
  assert.match(preparation, /skipReason: eligibility\.eligible \? null/);
});

test("frequency caps cover customer, template, and rolling 30-day limits", () => {
  const now = new Date("2026-07-17T00:00:00Z");
  assert.deepEqual(frequencyReasons({
    recentCustomerMessages: 4,
    maximum30Days: 4,
    recentTemplateMessage: true,
    lastCampaignMessageAt: new Date("2026-07-16T00:00:00Z"),
    customerCooldownDays: 7,
    now
  }), ["CUSTOMER_30_DAY_FREQUENCY_CAP", "TEMPLATE_COOLDOWN", "CUSTOMER_COOLDOWN"]);
});

test("campaign jobs use stable BullMQ-compatible IDs for duplicate prevention", () => {
  const id = campaignRecipientJobId("campaign-id", "recipient-id");
  assert.equal(id, "campaign:campaign-id:recipient-recipient-id");
  assert.equal(id.split(":").length, 3);
});

test("automatic pause triggers on failure rate and consecutive failures", () => {
  assert.match(autoPauseReason({ sampled: 20, failed: 3, recentStatuses: [], minSample: 20, failureRatePercent: 15, consecutiveFailures: 10 }), /failure rate/);
  assert.match(autoPauseReason({ sampled: 10, failed: 10, recentStatuses: Array(10).fill("FAILED"), minSample: 20, failureRatePercent: 15, consecutiveFailures: 10 }), /Consecutive/);
  assert.equal(autoPauseReason({ sampled: 19, failed: 2, recentStatuses: ["FAILED", "SENT"], minSample: 20, failureRatePercent: 15, consecutiveFailures: 10 }), null);
});

test("Meta errors separate retryable, permanent, account, template, authentication, and rate limits", () => {
  assert.equal(classifyCampaignError({ status: 429 }).category, "RATE_LIMIT");
  assert.equal(classifyCampaignError({ status: 401 }).category, "AUTHENTICATION");
  assert.equal(classifyCampaignError({ details: { error: { code: 132015, message: "Template paused" } } }).category, "PERMANENT_TEMPLATE");
  assert.equal(classifyCampaignError({ details: { error: { code: 131031, message: "Account locked" } } }).category, "PERMANENT_ACCOUNT");
  assert.equal(classifyCampaignError({ status: 400, message: "Invalid recipient" }).category, "PERMANENT_RECIPIENT");
  assert.equal(classifyCampaignError({ status: 503 }).category, "RETRYABLE");
});

test("Arabic and English opt-out keywords are normalized", () => {
  for (const phrase of ["الغاء", "إلغاء", "توقف", "قف", "لا ترسل", "وقف الرسائل", "STOP", "unsubscribe", "cancel", "opt out"]) {
    assert.equal(isOptOutPhrase(phrase), true, phrase);
  }
  assert.equal(isOptOutPhrase("please continue"), false);
});

test("pause, resume, cancellation, restart recovery, phone competition, and idempotent claims are wired", () => {
  const control = source("src/services/campaign-control.service.js");
  const dispatcher = source("src/services/campaign-dispatcher.service.js");
  const sender = source("src/services/campaign-send.service.js");
  const worker = source("src/workers/campaign-send.worker.js");
  assert.match(control, /status: "PAUSED"/);
  assert.match(control, /CAMPAIGN_RESUMED/);
  assert.match(control, /status: "CANCELLED"/);
  assert.match(dispatcher, /phoneNumberId: campaign\.phoneNumberId/);
  assert.match(dispatcher, /campaign:dispatch-lock/);
  assert.match(worker, /dispatchActiveCampaigns\(\)/);
  assert.match(sender, /status: "QUEUED", whatsappMessageId: null/);
  assert.match(sender, /freshCampaign\.status !== "RUNNING"/);
});

test("template-variable validation remains mandatory before preparation", () => {
  const messages = source("src/services/message.service.js");
  assert.match(messages, /assertTemplateMappingComplete\(mappingStatus\)/);
  assert.match(messages, /components: evaluated\.components/);
});
