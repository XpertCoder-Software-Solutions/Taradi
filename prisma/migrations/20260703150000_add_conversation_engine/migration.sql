-- Enable UUID generation for backfilling existing customer conversations.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "Message" ADD COLUMN "body" TEXT;

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "assignedEmployeeId" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "priority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- Backfill one MVP conversation per existing customer.
INSERT INTO "Conversation" (
    "id",
    "customerId",
    "assignedEmployeeId",
    "status",
    "priority",
    "tags",
    "createdAt",
    "updatedAt"
)
SELECT
    gen_random_uuid()::TEXT,
    "id",
    "assignedToId",
    'OPEN',
    'NORMAL',
    ARRAY[]::TEXT[],
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Customer";

-- Link existing messages to their customer conversation and populate body for the new API field.
UPDATE "Message" AS m
SET
    "conversationId" = c."id",
    "body" = COALESCE(m."body", m."content")
FROM "Conversation" AS c
WHERE m."customerId" = c."customerId";

-- Set last message pointers from existing message history.
UPDATE "Conversation" AS c
SET
    "lastMessageId" = latest."id",
    "lastMessageAt" = latest."createdAt",
    "updatedAt" = CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON ("customerId")
        "customerId",
        "id",
        "createdAt"
    FROM "Message"
    ORDER BY "customerId", "createdAt" DESC, "id" DESC
) AS latest
WHERE latest."customerId" = c."customerId";

-- Seed unread counts from inbound received messages for existing data.
UPDATE "Conversation" AS c
SET
    "unreadCount" = unread."count",
    "updatedAt" = CURRENT_TIMESTAMP
FROM (
    SELECT
        "customerId",
        COUNT(*)::INTEGER AS "count"
    FROM "Message"
    WHERE "direction" = 'INBOUND'
    GROUP BY "customerId"
) AS unread
WHERE unread."customerId" = c."customerId";

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_customerId_key" ON "Conversation"("customerId");

-- CreateIndex
CREATE INDEX "Conversation_assignedEmployeeId_idx" ON "Conversation"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "Conversation_status_idx" ON "Conversation"("status");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_priority_idx" ON "Conversation"("priority");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_lastMessageId_fkey" FOREIGN KEY ("lastMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
