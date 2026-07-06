-- Add message types needed by the media-capable Conversation Engine.
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'VOICE' AFTER 'AUDIO';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'SYSTEM' AFTER 'INTERACTIVE';

-- Store WhatsApp and local media metadata on each message.
ALTER TABLE "Message" ADD COLUMN "mediaUrl" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaId" TEXT;
ALTER TABLE "Message" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "Message" ADD COLUMN "fileName" TEXT;
ALTER TABLE "Message" ADD COLUMN "fileSize" INTEGER;
ALTER TABLE "Message" ADD COLUMN "caption" TEXT;
ALTER TABLE "Message" ADD COLUMN "duration" INTEGER;

CREATE INDEX "Message_mediaId_idx" ON "Message"("mediaId");
