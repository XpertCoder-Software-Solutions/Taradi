const IORedis = require("ioredis");
const env = require("./env");
const logger = require("./logger");

function createRedisConnection() {
  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null
  });

  connection.on("error", (error) => {
    logger.error({ err: error }, "Redis connection error");
  });

  return connection;
}

module.exports = {
  createRedisConnection
};
