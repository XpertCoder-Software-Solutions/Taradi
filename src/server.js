const http = require("http");
const app = require("./app");
const env = require("./config/env");
const prisma = require("./config/prisma");
const logger = require("./config/logger");
const { closeSocketRealtime, initSocket } = require("./socket");
const { closeRateLimiter } = require("./middleware/rateLimit.middleware");
const { closeWhatsAppQueue } = require("./queues/whatsapp.queue");
const { closeWebhookQueue } = require("./queues/webhook.queue");
const { closeCampaignPrepareQueue } = require("./queues/campaign.queue");
const { validateWhatsAppRuntimeConfig } = require("./services/whatsapp.service");
const { startTemplateAutoSync, stopTemplateAutoSync } = require("./modules/templates/template.service");

async function start() {
  await prisma.$connect();

  if (env.DEBUG) {
    logger.info("DEBUG MODE ENABLED");
  }
  validateWhatsAppRuntimeConfig();
  startTemplateAutoSync();

  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Taradi backend listening");
  });

  const shutdown = async () => {
    logger.info("Shutting down Taradi backend");
    stopTemplateAutoSync();
    server.close(async () => {
      await closeRateLimiter();
      await closeWebhookQueue();
      await closeWhatsAppQueue();
      await closeCampaignPrepareQueue();
      await closeSocketRealtime();
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch(async (error) => {
  logger.error({ err: error }, "Failed to start Taradi backend");
  await closeRateLimiter();
  await closeWebhookQueue();
  await closeWhatsAppQueue();
  await closeCampaignPrepareQueue();
  await closeSocketRealtime();
  await prisma.$disconnect();
  process.exit(1);
});
