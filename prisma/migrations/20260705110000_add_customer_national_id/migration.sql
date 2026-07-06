ALTER TABLE "Customer" ADD COLUMN "nationalId" TEXT;

CREATE INDEX "Customer_nationalId_idx" ON "Customer"("nationalId");
