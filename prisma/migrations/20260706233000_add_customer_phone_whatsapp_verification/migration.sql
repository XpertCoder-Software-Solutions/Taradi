CREATE TYPE "WhatsAppPhoneStatus" AS ENUM (
  'PENDING',
  'AVAILABLE',
  'NOT_AVAILABLE',
  'CHECK_FAILED'
);

ALTER TABLE "CustomerPhone"
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "whatsappStatus" "WhatsAppPhoneStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "whatsappCheckedAt" TIMESTAMP(3),
ADD COLUMN "whatsappWaId" TEXT,
ADD COLUMN "whatsappError" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

WITH ordered_phones AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "customerId"
      ORDER BY "isPrimary" DESC, "createdAt" ASC, "id" ASC
    ) - 1 AS row_position
  FROM "CustomerPhone"
)
UPDATE "CustomerPhone" AS phone
SET "position" = ordered_phones.row_position
FROM ordered_phones
WHERE phone."id" = ordered_phones."id";

CREATE INDEX "CustomerPhone_position_idx" ON "CustomerPhone"("position");
CREATE INDEX "CustomerPhone_whatsappStatus_idx" ON "CustomerPhone"("whatsappStatus");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "customerId" TEXT,
  "payload" JSONB,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_customerId_idx" ON "AuditLog"("customerId");
