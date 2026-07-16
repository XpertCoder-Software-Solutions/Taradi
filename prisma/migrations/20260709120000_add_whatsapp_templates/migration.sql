CREATE TABLE "WhatsappTemplate" (
    "id" TEXT NOT NULL,
    "metaTemplateId" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "headerType" TEXT,
    "headerText" TEXT,
    "body" TEXT,
    "footer" TEXT,
    "buttons" JSONB,
    "variables" JSONB,
    "rawMetaResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappTemplate_metaTemplateId_key" ON "WhatsappTemplate"("metaTemplateId");
CREATE UNIQUE INDEX "WhatsappTemplate_name_language_key" ON "WhatsappTemplate"("name", "language");
CREATE INDEX "WhatsappTemplate_status_idx" ON "WhatsappTemplate"("status");
CREATE INDEX "WhatsappTemplate_category_idx" ON "WhatsappTemplate"("category");
CREATE INDEX "WhatsappTemplate_language_idx" ON "WhatsappTemplate"("language");
