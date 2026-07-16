CREATE TYPE "CampaignStatus" AS ENUM (
    'DRAFT',
    'PREPARING',
    'READY',
    'QUEUED',
    'RUNNING',
    'PAUSED',
    'COMPLETED',
    'COMPLETED_WITH_ERRORS',
    'FAILED',
    'CANCELLED'
);

CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "selectionMode" TEXT NOT NULL DEFAULT 'explicit',
    "filters" JSONB,
    "excludedCustomerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "rawPayload" JSONB,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "preparedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Message" ADD COLUMN "campaignId" TEXT;

CREATE UNIQUE INDEX "Campaign_idempotencyKey_key" ON "Campaign"("idempotencyKey");
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");
CREATE INDEX "Campaign_createdById_idx" ON "Campaign"("createdById");
CREATE INDEX "Campaign_templateId_idx" ON "Campaign"("templateId");
CREATE INDEX "Campaign_createdAt_idx" ON "Campaign"("createdAt");
CREATE INDEX "Message_campaignId_idx" ON "Message"("campaignId");
CREATE INDEX "Message_campaignId_status_idx" ON "Message"("campaignId", "status");

ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Message"
    ADD CONSTRAINT "Message_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
