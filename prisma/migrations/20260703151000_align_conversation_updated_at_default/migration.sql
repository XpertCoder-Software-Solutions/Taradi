-- Align the database column with Prisma's @updatedAt behavior.
ALTER TABLE "Conversation" ALTER COLUMN "updatedAt" DROP DEFAULT;
