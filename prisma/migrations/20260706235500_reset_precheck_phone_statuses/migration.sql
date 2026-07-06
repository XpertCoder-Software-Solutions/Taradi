UPDATE "CustomerPhone"
SET
  "whatsappStatus" = 'UNKNOWN',
  "whatsappError" = NULL,
  "whatsappCheckedAt" = NULL,
  "whatsappWaId" = NULL
WHERE "whatsappStatus" IN ('PENDING', 'CHECK_FAILED');
