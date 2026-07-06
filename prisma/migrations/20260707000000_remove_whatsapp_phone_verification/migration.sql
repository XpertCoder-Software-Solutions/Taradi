DROP INDEX IF EXISTS "CustomerPhone_whatsappStatus_idx";

ALTER TABLE "CustomerPhone"
  DROP COLUMN IF EXISTS "whatsappStatus",
  DROP COLUMN IF EXISTS "whatsappCheckedAt",
  DROP COLUMN IF EXISTS "whatsappWaId",
  DROP COLUMN IF EXISTS "whatsappError";

DROP TABLE IF EXISTS "AuditLog";

DROP TYPE IF EXISTS "WhatsAppPhoneStatus";
