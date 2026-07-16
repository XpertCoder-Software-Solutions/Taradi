ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

CREATE TABLE "UserImportAuditLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "importedCount" INTEGER NOT NULL,
  "failedCount" INTEGER NOT NULL,
  "fileName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserImportAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserImportAuditLog_actorUserId_createdAt_idx" ON "UserImportAuditLog"("actorUserId", "createdAt");
CREATE INDEX "UserImportAuditLog_action_createdAt_idx" ON "UserImportAuditLog"("action", "createdAt");
ALTER TABLE "UserImportAuditLog" ADD CONSTRAINT "UserImportAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
