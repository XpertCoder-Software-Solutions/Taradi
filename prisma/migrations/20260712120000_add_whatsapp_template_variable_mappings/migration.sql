CREATE TABLE "WhatsappTemplateVariableMapping" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "variableKey" TEXT NOT NULL,
    "placeholderNumber" INTEGER NOT NULL,
    "componentType" TEXT NOT NULL,
    "buttonIndex" INTEGER,
    "source" TEXT,
    "fieldKey" TEXT NOT NULL,
    "transformer" TEXT,
    "fallbackValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappTemplateVariableMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappTemplateVariableMapping_templateId_language_variableKey_key"
    ON "WhatsappTemplateVariableMapping"("templateId", "language", "variableKey");

CREATE INDEX "WhatsappTemplateVariableMapping_templateId_idx"
    ON "WhatsappTemplateVariableMapping"("templateId");

CREATE INDEX "WhatsappTemplateVariableMapping_language_idx"
    ON "WhatsappTemplateVariableMapping"("language");

CREATE INDEX "WhatsappTemplateVariableMapping_fieldKey_idx"
    ON "WhatsappTemplateVariableMapping"("fieldKey");

ALTER TABLE "WhatsappTemplateVariableMapping"
    ADD CONSTRAINT "WhatsappTemplateVariableMapping_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "WhatsappTemplate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
