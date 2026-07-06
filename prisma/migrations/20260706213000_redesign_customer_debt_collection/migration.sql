CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PAID', 'SCHEDULED', 'DISPUTED', 'CANCELLED');

ALTER TABLE "Customer"
ADD COLUMN "fullName" TEXT,
ADD COLUMN "accountNumber" TEXT,
ADD COLUMN "projectName" TEXT,
ADD COLUMN "debtAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "serviceNumber" TEXT,
ADD COLUMN "serviceActivationDate" TIMESTAMP(3),
ADD COLUMN "serviceTerminationDate" TIMESTAMP(3),
ADD COLUMN "invoiceStatus" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN "debtYear" INTEGER;

UPDATE "Customer"
SET
  "fullName" = COALESCE(NULLIF(TRIM("name"), ''), NULLIF(TRIM("whatsappProfileName"), ''), "phone"),
  "accountNumber" = COALESCE(NULLIF(TRIM("nationalId"), ''), 'LEGACY-' || SUBSTRING("id" FROM 1 FOR 8)),
  "projectName" = 'غير محدد',
  "serviceNumber" = "phone",
  "debtYear" = EXTRACT(YEAR FROM NOW())::INTEGER;

WITH duplicate_national_ids AS (
  SELECT
    "id",
    "nationalId",
    ROW_NUMBER() OVER (PARTITION BY "nationalId" ORDER BY "createdAt", "id") AS row_number
  FROM "Customer"
  WHERE "nationalId" IS NOT NULL AND NULLIF(TRIM("nationalId"), '') IS NOT NULL
)
UPDATE "Customer" AS customer
SET "nationalId" = customer."nationalId" || '-' || SUBSTRING(customer."id" FROM 1 FOR 8)
FROM duplicate_national_ids
WHERE customer."id" = duplicate_national_ids."id"
  AND duplicate_national_ids.row_number > 1;

ALTER TABLE "Customer"
ALTER COLUMN "fullName" SET NOT NULL,
ALTER COLUMN "accountNumber" SET NOT NULL,
ALTER COLUMN "projectName" SET NOT NULL,
ALTER COLUMN "serviceNumber" SET NOT NULL,
ALTER COLUMN "debtYear" SET NOT NULL;

DROP INDEX IF EXISTS "Customer_nationalId_idx";
CREATE UNIQUE INDEX "Customer_nationalId_key" ON "Customer"("nationalId");
CREATE UNIQUE INDEX "Customer_accountNumber_key" ON "Customer"("accountNumber");
CREATE INDEX "Customer_accountNumber_idx" ON "Customer"("accountNumber");
CREATE INDEX "Customer_projectName_idx" ON "Customer"("projectName");
CREATE INDEX "Customer_serviceNumber_idx" ON "Customer"("serviceNumber");
CREATE INDEX "Customer_invoiceStatus_idx" ON "Customer"("invoiceStatus");
CREATE INDEX "Customer_debtYear_idx" ON "Customer"("debtYear");

CREATE TABLE "CustomerPhone" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerPhone_pkey" PRIMARY KEY ("id")
);

INSERT INTO "CustomerPhone" ("id", "customerId", "phoneNumber", "isPrimary", "createdAt")
SELECT 'phone-' || "id", "id", "phone", true, NOW()
FROM "Customer"
WHERE "phone" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "CustomerPhone_phoneNumber_key" ON "CustomerPhone"("phoneNumber");
CREATE INDEX "CustomerPhone_customerId_idx" ON "CustomerPhone"("customerId");
CREATE INDEX "CustomerPhone_isPrimary_idx" ON "CustomerPhone"("isPrimary");

ALTER TABLE "CustomerPhone"
ADD CONSTRAINT "CustomerPhone_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
