-- Additive indexes for Phase 2 production performance work.
-- These match the current high-traffic access patterns for staff lists,
-- customer pages, inbox sorting, message retries, and webhook auditing.

CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");
CREATE INDEX "User_supervisorId_role_isActive_idx" ON "User"("supervisorId", "role", "isActive");

CREATE INDEX "WebhookEvent_provider_eventType_createdAt_idx" ON "WebhookEvent"("provider", "eventType", "createdAt");
CREATE INDEX "WebhookEvent_whatsappMessageId_status_idx" ON "WebhookEvent"("whatsappMessageId", "status");

CREATE INDEX "Customer_assignedToId_createdAt_idx" ON "Customer"("assignedToId", "createdAt");
CREATE INDEX "Customer_assignedToId_collectionStatus_createdAt_idx" ON "Customer"("assignedToId", "collectionStatus", "createdAt");
CREATE INDEX "Customer_collectionStatus_createdAt_idx" ON "Customer"("collectionStatus", "createdAt");

CREATE INDEX "CustomerPhone_customerId_isPrimary_position_idx" ON "CustomerPhone"("customerId", "isPrimary", "position");

CREATE INDEX "Message_status_statusUpdatedAt_idx" ON "Message"("status", "statusUpdatedAt");

CREATE INDEX "Conversation_assignedEmployeeId_lastMessageAt_idx" ON "Conversation"("assignedEmployeeId", "lastMessageAt");
CREATE INDEX "Conversation_assignedEmployeeId_status_lastMessageAt_idx" ON "Conversation"("assignedEmployeeId", "status", "lastMessageAt");
CREATE INDEX "Conversation_status_lastMessageAt_idx" ON "Conversation"("status", "lastMessageAt");
