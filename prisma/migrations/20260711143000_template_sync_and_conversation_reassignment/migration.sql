-- Production deployment fixes:
-- 1. Persist complete Meta template synchronization metadata.
-- 2. Allow archived conversation history while enforcing one active conversation per customer.

ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

ALTER TABLE "WhatsappTemplate"
  ADD COLUMN "components" JSONB,
  ADD COLUMN "qualityScore" JSONB,
  ADD COLUMN "rejectedReason" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

UPDATE "WhatsappTemplate"
SET
  "components" = COALESCE("rawMetaResponse"->'components', '[]'::jsonb),
  "qualityScore" = "rawMetaResponse"->'quality_score',
  "rejectedReason" = COALESCE("rawMetaResponse"->>'rejected_reason', "rawMetaResponse"->>'rejectedReason'),
  "lastSyncedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "rawMetaResponse" IS NOT NULL;

CREATE INDEX "WhatsappTemplate_isActive_status_idx" ON "WhatsappTemplate"("isActive", "status");
CREATE INDEX "WhatsappTemplate_lastSyncedAt_idx" ON "WhatsappTemplate"("lastSyncedAt");

ALTER TABLE "Conversation"
  ADD COLUMN "activeKey" TEXT,
  ADD COLUMN "archivedById" TEXT,
  ADD COLUMN "archiveReason" TEXT,
  ADD COLUMN "previousAssigneeId" TEXT,
  ADD COLUMN "reassignedToId" TEXT,
  ADD COLUMN "reassignedAt" TIMESTAMP(3);

UPDATE "Conversation"
SET "activeKey" = "customerId"
WHERE "archivedAt" IS NULL AND "status"::text <> 'ARCHIVED';

DROP INDEX IF EXISTS "Conversation_customerId_key";
CREATE UNIQUE INDEX "Conversation_activeKey_key" ON "Conversation"("activeKey");
CREATE INDEX "Conversation_customerId_idx" ON "Conversation"("customerId");
CREATE INDEX "Conversation_archivedAt_idx" ON "Conversation"("archivedAt");
CREATE INDEX "Conversation_previousAssigneeId_idx" ON "Conversation"("previousAssigneeId");
CREATE INDEX "Conversation_reassignedToId_idx" ON "Conversation"("reassignedToId");

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Conversation_previousAssigneeId_fkey" FOREIGN KEY ("previousAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Conversation_reassignedToId_fkey" FOREIGN KEY ("reassignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ConversationAssignmentHistory" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "archivedConversationId" TEXT,
  "activeConversationId" TEXT,
  "previousAssigneeId" TEXT,
  "newAssigneeId" TEXT,
  "reassignedById" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConversationAssignmentHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationAssignmentHistory_customerId_createdAt_idx" ON "ConversationAssignmentHistory"("customerId", "createdAt");
CREATE INDEX "ConversationAssignmentHistory_archivedConversationId_idx" ON "ConversationAssignmentHistory"("archivedConversationId");
CREATE INDEX "ConversationAssignmentHistory_activeConversationId_idx" ON "ConversationAssignmentHistory"("activeConversationId");
CREATE INDEX "ConversationAssignmentHistory_previousAssigneeId_idx" ON "ConversationAssignmentHistory"("previousAssigneeId");
CREATE INDEX "ConversationAssignmentHistory_newAssigneeId_idx" ON "ConversationAssignmentHistory"("newAssigneeId");
CREATE INDEX "ConversationAssignmentHistory_reassignedById_idx" ON "ConversationAssignmentHistory"("reassignedById");

ALTER TABLE "ConversationAssignmentHistory"
  ADD CONSTRAINT "ConversationAssignmentHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ConversationAssignmentHistory_archivedConversationId_fkey" FOREIGN KEY ("archivedConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ConversationAssignmentHistory_activeConversationId_fkey" FOREIGN KEY ("activeConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ConversationAssignmentHistory_previousAssigneeId_fkey" FOREIGN KEY ("previousAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ConversationAssignmentHistory_newAssigneeId_fkey" FOREIGN KEY ("newAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ConversationAssignmentHistory_reassignedById_fkey" FOREIGN KEY ("reassignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
