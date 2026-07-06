-- Add persisted employee activity fields used by the Employees Management table.
CREATE TYPE "EmployeeActivityType" AS ENUM (
  'LOGIN',
  'SENT_MESSAGE',
  'READ_CHAT',
  'UPDATED_CUSTOMER',
  'ASSIGNED_CUSTOMER',
  'CHANGED_CONVERSATION_STATUS',
  'NONE'
);

ALTER TABLE "User"
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "lastActivityAt" TIMESTAMP(3),
  ADD COLUMN "lastActivityType" "EmployeeActivityType" NOT NULL DEFAULT 'NONE';

CREATE INDEX "User_lastActivityAt_idx" ON "User"("lastActivityAt");
