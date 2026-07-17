-- Campaign safety engine: additive, non-destructive migration.
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'CANCELLED');
CREATE TYPE "WhatsappAccountStatus" AS ENUM ('UNKNOWN', 'ACTIVE', 'RESTRICTED', 'DISABLED', 'BANNED');
CREATE TYPE "WhatsappQualityStatus" AS ENUM ('UNKNOWN', 'GREEN', 'YELLOW', 'RED', 'LOW');

ALTER TABLE "Customer"
  ADD COLUMN "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "whatsappOptInAt" TIMESTAMP(3),
  ADD COLUMN "whatsappOptInSource" TEXT,
  ADD COLUMN "whatsappOptOutAt" TIMESTAMP(3),
  ADD COLUMN "whatsappOptOutReason" TEXT,
  ADD COLUMN "whatsappOptOutMessageId" TEXT,
  ADD COLUMN "whatsappSuppressed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "whatsappSuppressionReason" TEXT,
  ADD COLUMN "lastCampaignMessageAt" TIMESTAMP(3),
  ADD COLUMN "campaignMessageCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Campaign"
  ADD COLUMN "phoneNumberId" TEXT,
  ADD COLUMN "pauseReason" TEXT,
  ADD COLUMN "pausedAt" TIMESTAMP(3),
  ADD COLUMN "rateLimitPerMinute" INTEGER,
  ADD COLUMN "batchSize" INTEGER,
  ADD COLUMN "batchDelayMs" INTEGER;

ALTER TABLE "CampaignRecipient"
  ADD COLUMN "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "whatsappMessageId" TEXT,
  ADD COLUMN "errorCategory" TEXT,
  ADD COLUMN "errorMessage" TEXT;

-- Preserve legacy campaign recipient state when introducing the new state machine.
UPDATE "CampaignRecipient"
SET "status" = CASE "sendStatus"::text
  WHEN 'SENT' THEN 'SENT'::"CampaignRecipientStatus"
  WHEN 'DELIVERED' THEN 'DELIVERED'::"CampaignRecipientStatus"
  WHEN 'READ' THEN 'READ'::"CampaignRecipientStatus"
  WHEN 'FAILED' THEN 'FAILED'::"CampaignRecipientStatus"
  ELSE 'QUEUED'::"CampaignRecipientStatus"
END;

CREATE TABLE "WhatsappPhoneNumber" (
  "id" TEXT NOT NULL,
  "phoneNumberId" TEXT NOT NULL,
  "displayPhoneNumber" TEXT,
  "campaignsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "accountStatus" "WhatsappAccountStatus" NOT NULL DEFAULT 'UNKNOWN',
  "qualityStatus" "WhatsappQualityStatus" NOT NULL DEFAULT 'UNKNOWN',
  "lastStatusCheckAt" TIMESTAMP(3),
  "disabledReason" TEXT,
  "maxCampaignMessagesPerMinute" INTEGER,
  "campaignBatchSize" INTEGER,
  "campaignBatchDelayMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsappPhoneNumber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationSetting" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "description" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GlobalWhatsappSuppression" (
  "id" TEXT NOT NULL,
  "normalizedPhone" TEXT NOT NULL,
  "reason" TEXT,
  "source" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlobalWhatsappSuppression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignAuditLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "campaignId" TEXT,
  "customerId" TEXT,
  "oldValue" JSONB,
  "newValue" JSONB,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignAdminAlert" (
  "id" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'ERROR',
  "category" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "phoneNumberId" TEXT,
  "campaignId" TEXT,
  "createdById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignAdminAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappPhoneNumber_phoneNumberId_key" ON "WhatsappPhoneNumber"("phoneNumberId");
CREATE UNIQUE INDEX "ApplicationSetting_key_key" ON "ApplicationSetting"("key");
CREATE UNIQUE INDEX "GlobalWhatsappSuppression_normalizedPhone_key" ON "GlobalWhatsappSuppression"("normalizedPhone");
CREATE INDEX "Customer_whatsappOptIn_idx" ON "Customer"("whatsappOptIn");
CREATE INDEX "Customer_whatsappSuppressed_idx" ON "Customer"("whatsappSuppressed");
CREATE INDEX "Customer_lastCampaignMessageAt_idx" ON "Customer"("lastCampaignMessageAt");
CREATE INDEX "Campaign_phoneNumberId_status_idx" ON "Campaign"("phoneNumberId", "status");
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");
CREATE INDEX "WhatsappPhoneNumber_campaignsEnabled_accountStatus_idx" ON "WhatsappPhoneNumber"("campaignsEnabled", "accountStatus");
CREATE INDEX "ApplicationSetting_key_idx" ON "ApplicationSetting"("key");
CREATE INDEX "GlobalWhatsappSuppression_normalizedPhone_idx" ON "GlobalWhatsappSuppression"("normalizedPhone");
CREATE INDEX "CampaignAuditLog_campaignId_createdAt_idx" ON "CampaignAuditLog"("campaignId", "createdAt");
CREATE INDEX "CampaignAuditLog_customerId_createdAt_idx" ON "CampaignAuditLog"("customerId", "createdAt");
CREATE INDEX "CampaignAuditLog_actorId_createdAt_idx" ON "CampaignAuditLog"("actorId", "createdAt");
CREATE INDEX "CampaignAuditLog_action_createdAt_idx" ON "CampaignAuditLog"("action", "createdAt");
CREATE INDEX "CampaignAdminAlert_phoneNumberId_resolvedAt_idx" ON "CampaignAdminAlert"("phoneNumberId", "resolvedAt");
CREATE INDEX "CampaignAdminAlert_campaignId_createdAt_idx" ON "CampaignAdminAlert"("campaignId", "createdAt");

ALTER TABLE "CampaignAuditLog" ADD CONSTRAINT "CampaignAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignAuditLog" ADD CONSTRAINT "CampaignAuditLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignAuditLog" ADD CONSTRAINT "CampaignAuditLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignAdminAlert" ADD CONSTRAINT "CampaignAdminAlert_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignAdminAlert" ADD CONSTRAINT "CampaignAdminAlert_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
