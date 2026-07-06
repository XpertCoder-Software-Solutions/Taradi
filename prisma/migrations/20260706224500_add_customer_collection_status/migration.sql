CREATE TYPE "CollectionStatus" AS ENUM (
  'ACTIVE_DEBT',
  'PAID',
  'PARTIALLY_PAID',
  'PROMISED_TO_PAY',
  'DISPUTED',
  'DO_NOT_CONTACT'
);

ALTER TABLE "Customer"
ADD COLUMN "collectionStatus" "CollectionStatus" NOT NULL DEFAULT 'ACTIVE_DEBT',
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "paidAmount" DECIMAL(14,2),
ADD COLUMN "paymentReference" TEXT,
ADD COLUMN "paymentNotes" TEXT;

CREATE INDEX "Customer_collectionStatus_idx" ON "Customer"("collectionStatus");
CREATE INDEX "Customer_paidAt_idx" ON "Customer"("paidAt");
