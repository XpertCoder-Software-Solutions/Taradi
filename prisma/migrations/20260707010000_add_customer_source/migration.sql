ALTER TABLE "Customer" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';

CREATE INDEX "Customer_source_idx" ON "Customer"("source");
