-- Additive phase 1: preserve all legacy Customer debt columns until production verification.
CREATE TABLE "CustomerDebt" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "projectName" TEXT,
  "projectNameRaw" TEXT,
  "accountNumber" TEXT NOT NULL,
  "serviceNumber" TEXT,
  "debtYear" INTEGER NOT NULL,
  "debtAmount" DECIMAL(14,2) NOT NULL,
  "invoiceStatus" "InvoiceStatus",
  "collectionStatus" "CollectionStatus",
  "serviceActivationDate" TIMESTAMP(3),
  "serviceTerminationDate" TIMESTAMP(3),
  "paidAmount" DECIMAL(14,2),
  "paidAt" TIMESTAMP(3),
  "paymentReference" TEXT,
  "paymentNotes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerDebt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerDebt_debtYear_min_check" CHECK ("debtYear" >= 2000)
);

CREATE TABLE "CampaignRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "debtId" TEXT NOT NULL,
  "phoneSnapshot" TEXT,
  "projectSnapshot" TEXT,
  "accountNumberSnapshot" TEXT,
  "serviceNumberSnapshot" TEXT,
  "debtYearSnapshot" INTEGER,
  "debtAmountSnapshot" DECIMAL(14,2),
  "resolvedTemplateParameters" JSONB,
  "eligible" BOOLEAN NOT NULL DEFAULT false,
  "skipReason" TEXT,
  "sendStatus" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
  "messageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DebtAuditLog" (
  "id" TEXT NOT NULL,
  "debtId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "changes" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DebtAuditLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Campaign" ADD COLUMN "excludedDebtIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Message" ADD COLUMN "debtId" TEXT;
ALTER TABLE "WhatsappTemplateVariableMapping" ADD COLUMN "sourceScope" TEXT NOT NULL DEFAULT 'customer';
UPDATE "WhatsappTemplateVariableMapping" SET "sourceScope" = 'debt'
WHERE "fieldKey" IN ('accountNumber','serviceNumber','projectName','projectNameRaw','debtAmount','debtYear','serviceActivationDate','serviceTerminationDate','invoiceStatus','invoiceStatusLabel','collectionStatus','collectionStatusLabel','paidAt','paidAmount','paymentReference');

-- Every legacy customer has an explicit debtYear, so it is the documented source.
-- The deterministic id and ON CONFLICT clause make this backfill safely repeatable.
INSERT INTO "CustomerDebt" (
  "id", "customerId", "projectName", "projectNameRaw", "accountNumber",
  "serviceNumber", "debtYear", "debtAmount", "invoiceStatus", "collectionStatus",
  "serviceActivationDate", "serviceTerminationDate", "paidAmount", "paidAt",
  "paymentReference", "paymentNotes", "isActive", "reviewRequired", "createdAt", "updatedAt"
)
SELECT
  substr(md5('legacy-customer-debt:' || c."id"),1,8) || '-' || substr(md5('legacy-customer-debt:' || c."id"),9,4) || '-4' || substr(md5('legacy-customer-debt:' || c."id"),14,3) || '-a' || substr(md5('legacy-customer-debt:' || c."id"),18,3) || '-' || substr(md5('legacy-customer-debt:' || c."id"),21,12), c."id", c."projectName", c."projectNameRaw",
  c."accountNumber", c."serviceNumber", c."debtYear", c."debtAmount",
  c."invoiceStatus", c."collectionStatus", c."serviceActivationDate",
  c."serviceTerminationDate", c."paidAmount", c."paidAt", c."paymentReference",
  c."paymentNotes", true, false, c."createdAt", c."updatedAt"
FROM "Customer" c
WHERE c."accountNumber" IS NOT NULL OR c."debtAmount" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "CustomerDebt_customerId_projectName_accountNumber_serviceNumber_debtYear_key" ON "CustomerDebt"("customerId", "projectName", "accountNumber", "serviceNumber", "debtYear");
CREATE INDEX "CustomerDebt_customerId_idx" ON "CustomerDebt"("customerId");
CREATE INDEX "CustomerDebt_customerId_isActive_idx" ON "CustomerDebt"("customerId", "isActive");
CREATE INDEX "CustomerDebt_projectName_idx" ON "CustomerDebt"("projectName");
CREATE INDEX "CustomerDebt_debtYear_idx" ON "CustomerDebt"("debtYear");
CREATE INDEX "CustomerDebt_accountNumber_idx" ON "CustomerDebt"("accountNumber");
CREATE INDEX "CustomerDebt_serviceNumber_idx" ON "CustomerDebt"("serviceNumber");
CREATE INDEX "CustomerDebt_collectionStatus_idx" ON "CustomerDebt"("collectionStatus");
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_debtId_key" ON "CampaignRecipient"("campaignId", "debtId");
CREATE INDEX "CampaignRecipient_campaignId_eligible_idx" ON "CampaignRecipient"("campaignId", "eligible");
CREATE INDEX "CampaignRecipient_customerId_idx" ON "CampaignRecipient"("customerId");
CREATE INDEX "CampaignRecipient_debtId_idx" ON "CampaignRecipient"("debtId");
CREATE INDEX "DebtAuditLog_debtId_createdAt_idx" ON "DebtAuditLog"("debtId", "createdAt");
CREATE INDEX "DebtAuditLog_customerId_createdAt_idx" ON "DebtAuditLog"("customerId", "createdAt");
CREATE INDEX "DebtAuditLog_actorId_createdAt_idx" ON "DebtAuditLog"("actorId", "createdAt");
CREATE INDEX "Message_debtId_idx" ON "Message"("debtId");
CREATE INDEX "WhatsappTemplateVariableMapping_sourceScope_idx" ON "WhatsappTemplateVariableMapping"("sourceScope");

ALTER TABLE "CustomerDebt" ADD CONSTRAINT "CustomerDebt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "CustomerDebt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DebtAuditLog" ADD CONSTRAINT "DebtAuditLog_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "CustomerDebt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DebtAuditLog" ADD CONSTRAINT "DebtAuditLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "CustomerDebt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
