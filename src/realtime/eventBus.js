const crypto = require("crypto");
const { createRedisConnection } = require("../config/redis");
const logger = require("../config/logger");

const REALTIME_EVENTS_CHANNEL = "taradi:realtime:events";
const REALTIME_DEDUPE_PREFIX = "taradi:realtime:dedupe";
const REALTIME_DEDUPE_TTL_SECONDS = 60;

const allowedRealtimeEvents = new Set([
  "conversation:new_message",
  "conversation:updated",
  "message:received",
  "message:sent",
  "message:status",
  "inbox:updated",
  "unread-count:updated",
  "notification:unread_count"
  ,"customer:communication_preferences"
]);

let publisherClient = null;
let subscriberClient = null;
let dedupeClient = null;

function wireRedisClientLogging(client, role) {
  client.on("connect", () => {
    logger.info({ channel: REALTIME_EVENTS_CHANNEL, role }, "Realtime Redis connection opened");
  });

  client.on("ready", () => {
    logger.info({ channel: REALTIME_EVENTS_CHANNEL, role }, "Realtime Redis connection ready");
  });

  client.on("close", () => {
    logger.warn({ channel: REALTIME_EVENTS_CHANNEL, role }, "Realtime Redis connection closed");
  });

  client.on("reconnecting", (delay) => {
    logger.warn({ channel: REALTIME_EVENTS_CHANNEL, role, delay }, "Realtime Redis connection reconnecting");
  });

  client.on("end", () => {
    logger.warn({ channel: REALTIME_EVENTS_CHANNEL, role }, "Realtime Redis connection ended");
  });
}

function getPublisherClient() {
  if (!publisherClient || publisherClient.status === "end") {
    publisherClient = createRedisConnection({
      connectionName: "taradi-realtime-publisher"
    });
    wireRedisClientLogging(publisherClient, "publisher");
  }

  return publisherClient;
}

function getSubscriberClient() {
  if (!subscriberClient || subscriberClient.status === "end") {
    subscriberClient = createRedisConnection({
      connectionName: "taradi-realtime-subscriber"
    });
    wireRedisClientLogging(subscriberClient, "subscriber");
  }

  return subscriberClient;
}

function getDedupeClient() {
  if (!dedupeClient || dedupeClient.status === "end") {
    dedupeClient = createRedisConnection({
      connectionName: "taradi-realtime-dedupe"
    });
    wireRedisClientLogging(dedupeClient, "dedupe");
  }

  return dedupeClient;
}

function normalizeRoom(room) {
  const value = String(room || "").trim();

  if (!value || value.length > 160) {
    return null;
  }

  return value;
}

function normalizeRooms(input) {
  const rooms = [];
  const rawRooms = Array.isArray(input.rooms) ? input.rooms : [];

  if (input.room) {
    rawRooms.push(input.room);
  }

  for (const room of rawRooms) {
    const normalized = normalizeRoom(room);

    if (normalized && !rooms.includes(normalized)) {
      rooms.push(normalized);
    }
  }

  return rooms;
}

function normalizeRealtimeEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Realtime event must be an object");
  }

  const event = String(input.event || "").trim();

  if (!allowedRealtimeEvents.has(event)) {
    throw new Error(`Unsupported realtime event: ${event || "missing"}`);
  }

  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
    ? input.payload
    : {};
  const rooms = normalizeRooms(input);
  const id = String(input.id || crypto.randomUUID()).trim();

  if (!id || id.length > 160) {
    throw new Error("Realtime event id is invalid");
  }

  return {
    id,
    event,
    rooms,
    room: rooms[0] || null,
    payload,
    publishedAt: input.publishedAt || new Date().toISOString(),
    source: input.source || "taradi"
  };
}

function parseRealtimeEventMessage(rawMessage) {
  let parsed;

  try {
    parsed = JSON.parse(rawMessage);
  } catch (error) {
    throw new Error("Realtime event message is not valid JSON");
  }

  return normalizeRealtimeEvent(parsed);
}

async function publishRealtimeEvent(input) {
  const event = normalizeRealtimeEvent(input);
  const client = getPublisherClient();

  await client.publish(REALTIME_EVENTS_CHANNEL, JSON.stringify(event));
  logger.info({
    id: event.id,
    event: event.event,
    rooms: event.rooms,
    channel: REALTIME_EVENTS_CHANNEL
  }, "Published realtime event");

  return {
    published: true,
    event
  };
}

async function safePublishRealtimeEvent(input) {
  try {
    return await publishRealtimeEvent(input);
  } catch (error) {
    logger.warn({
      err: error,
      event: input && input.event,
      room: input && input.room,
      rooms: input && input.rooms,
      channel: REALTIME_EVENTS_CHANNEL
    }, "Realtime Redis publish failed; persisted data will not be rolled back");

    return {
      published: false,
      error
    };
  }
}

async function claimRealtimeEvent(event) {
  if (!event || !event.id) {
    return true;
  }

  const key = `${REALTIME_DEDUPE_PREFIX}:${event.id}`;

  try {
    const result = await getDedupeClient().set(
      key,
      "1",
      "EX",
      REALTIME_DEDUPE_TTL_SECONDS,
      "NX"
    );

    return result === "OK";
  } catch (error) {
    logger.warn({ err: error, eventId: event.id, key }, "Realtime event dedupe failed; event will be emitted");
    return true;
  }
}

async function subscribeRealtimeEvents(onEvent) {
  if (typeof onEvent !== "function") {
    throw new Error("Realtime subscriber handler is required");
  }

  const client = getSubscriberClient();

  client.removeAllListeners("message");
  client.on("message", (channel, rawMessage) => {
    if (channel !== REALTIME_EVENTS_CHANNEL) {
      return;
    }

    let event;

    try {
      event = parseRealtimeEventMessage(rawMessage);
    } catch (error) {
      logger.warn({ err: error, channel }, "Ignored invalid realtime event");
      return;
    }

    Promise.resolve(onEvent(event)).catch((error) => {
      logger.error({ err: error, eventId: event.id, event: event.event }, "Realtime event handler failed");
    });
  });

  await client.subscribe(REALTIME_EVENTS_CHANNEL);
  logger.info({ channel: REALTIME_EVENTS_CHANNEL }, "Subscribed to realtime Redis events");

  return {
    channel: REALTIME_EVENTS_CHANNEL
  };
}

async function closeRealtimeEventBus() {
  const clients = [subscriberClient, publisherClient, dedupeClient];
  subscriberClient = null;
  publisherClient = null;
  dedupeClient = null;

  await Promise.all(clients.filter(Boolean).map(async (client) => {
    if (client.status !== "end") {
      await client.quit();
    }
  }));
}

module.exports = {
  REALTIME_EVENTS_CHANNEL,
  allowedRealtimeEvents,
  normalizeRealtimeEvent,
  parseRealtimeEventMessage,
  publishRealtimeEvent,
  safePublishRealtimeEvent,
  claimRealtimeEvent,
  subscribeRealtimeEvents,
  closeRealtimeEventBus
};
