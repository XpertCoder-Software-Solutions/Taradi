const http = require("http");
const app = require("./app");
const env = require("./config/env");
const prisma = require("./config/prisma");
const logger = require("./config/logger");
const { initSocket } = require("./socket");
const { closeWhatsAppQueue } = require("./queues/whatsapp.queue");
const { validateWhatsAppRuntimeConfig } = require("./services/whatsapp.service");

async function start() {
  await prisma.$connect();

  if (env.DEBUG) {
    logger.info("DEBUG MODE ENABLED");
  }
  validateWhatsAppRuntimeConfig();

  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Taradi backend listening");
  });

  const shutdown = async () => {
    logger.info("Shutting down Taradi backend");
    server.close(async () => {
      await closeWhatsAppQueue();
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch(async (error) => {
  logger.error({ err: error }, "Failed to start Taradi backend");
  await closeWhatsAppQueue();
  await prisma.$disconnect();
  process.exit(1);
});
