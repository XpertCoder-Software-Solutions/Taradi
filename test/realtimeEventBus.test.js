const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-with-at-least-32-chars";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-whatsapp-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "test-phone-number-id";
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "test-business-account-id";
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "test-verify-token";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

const {
  REALTIME_EVENTS_CHANNEL,
  normalizeRealtimeEvent
} = require("../src/realtime/eventBus");
const {
  createRealtimeEventHandler,
  emitRealtimeEnvelope,
  notifyInboundMessage,
  _setRealtimeEventPublisherForTests,
  _setUnreadCountEmitterForTests
} = require("../src/socket");

const now = new Date("2026-07-12T12:00:00.000Z");

function sampleCustomer() {
  return {
    id: "customer-1",
    fullName: "عميل الاختبار",
    name: "عميل الاختبار",
    phone: "966500000001",
    accountNumber: "ACC-1",
    projectName: "Mobily",
    collectionStatus: "ACTIVE_DEBT",
    whatsappProfileName: "WA Customer",
    assignedToId: "employee-1",
    assignedTo: {
      id: "employee-1",
      employeeCode: "E001",
      name: "Employee One",
      role: "EMPLOYEE",
      supervisorId: "supervisor-1"
    },
    phones: [
      {
        phoneNumber: "966500000001",
        isPrimary: true
      }
    ],
    nationalId: "123456789012345"
  };
}

function sampleMessage() {
  return {
    id: "message-1",
    customerId: "customer-1",
    conversationId: "conversation-1",
    direction: "INBOUND",
    type: "TEXT",
    body: "مرحبا",
    content: "مرحبا",
    status: "RECEIVED",
    whatsappMessageId: "wamid-1",
    statusUpdatedAt: now,
    rawPayload: {
      source: "QUICK_SEND",
      access_token: "secret-token-that-must-not-leak"
    },
    createdAt: now,
    updatedAt: now
  };
}

function sampleConversation() {
  return {
    id: "conversation-1",
    customerId: "customer-1",
    customer: sampleCustomer(),
    assignedEmployeeId: "employee-1",
    assignedEmployee: sampleCustomer().assignedTo,
    lastMessage: sampleMessage(),
    lastMessageAt: now,
    unreadCount: 1,
    status: "OPEN",
    priority: "NORMAL",
    tags: [],
    archivedAt: null,
    archivedById: null,
    archiveReason: null,
    previousAssigneeId: null,
    reassignedToId: null,
    reassignedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

test.afterEach(() => {
  _setRealtimeEventPublisherForTests(null);
  _setUnreadCountEmitterForTests(null);
});

test("normalizes structured realtime events for the Redis channel", () => {
  const event = normalizeRealtimeEvent({
    event: "conversation:new_message",
    room: "conversation:conversation-1",
    rooms: ["admins", "conversation:conversation-1"],
    payload: { conversationId: "conversation-1" }
  });

  assert.equal(REALTIME_EVENTS_CHANNEL, "taradi:realtime:events");
  assert.equal(event.event, "conversation:new_message");
  assert.deepEqual(event.rooms, ["admins", "conversation:conversation-1"]);
  assert.equal(event.payload.conversationId, "conversation-1");
});

test("worker path publishes inbound message events after persistence with safe room targets", async () => {
  const published = [];

  _setRealtimeEventPublisherForTests(async (event) => {
    published.push(event);
    return { published: true, event };
  });
  _setUnreadCountEmitterForTests(async () => []);

  const result = await notifyInboundMessage(sampleCustomer(), sampleMessage(), sampleConversation());
  const newMessageEvent = published.find((event) => event.event === "conversation:new_message");

  assert.equal(result.published, true);
  assert.ok(newMessageEvent);
  assert.deepEqual(newMessageEvent.rooms, [
    "admins",
    "conversation:conversation-1",
    "user:employee-1",
    "user:supervisor-1"
  ]);
  assert.equal(newMessageEvent.payload.conversationId, "conversation-1");
  assert.equal(newMessageEvent.payload.message.id, "message-1");
  assert.equal(newMessageEvent.payload.message.rawPayload.source, "QUICK_SEND");
  assert.equal(JSON.stringify(newMessageEvent.payload).includes("secret-token-that-must-not-leak"), false);
  assert.equal(JSON.stringify(newMessageEvent.payload).includes("123456789012345"), false);
});

test("Redis publish failure is logged as fallback and does not fail inbound notification", async () => {
  _setRealtimeEventPublisherForTests(async () => {
    throw new Error("redis publish down");
  });
  _setUnreadCountEmitterForTests(async () => []);

  const result = await notifyInboundMessage(sampleCustomer(), sampleMessage(), sampleConversation());

  assert.equal(result.emitted, false);
  assert.equal(result.published, false);
});

test("API realtime handler emits to conversation and user rooms once after dedupe", async () => {
  const emitted = [];
  const fakeIo = {
    to(rooms) {
      return {
        emit(event, payload) {
          emitted.push({ rooms, event, payload });
        }
      };
    }
  };
  const seen = new Set();
  const handler = createRealtimeEventHandler(fakeIo, {
    claimRealtimeEvent: async (event) => {
      if (seen.has(event.id)) {
        return false;
      }

      seen.add(event.id);
      return true;
    }
  });
  const envelope = {
    id: "event-1",
    event: "message:received",
    rooms: ["conversation:conversation-1", "user:employee-1"],
    payload: {
      conversationId: "conversation-1",
      message: { id: "message-1" }
    }
  };

  await handler(envelope);
  await handler(envelope);

  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0].rooms, ["conversation:conversation-1", "user:employee-1"]);
  assert.equal(emitted[0].event, "message:received");
  assert.equal(emitted[0].payload.message.id, "message-1");
});

test("API emitter supports a specific conversation room", () => {
  const emitted = [];
  const fakeIo = {
    to(rooms) {
      return {
        emit(event, payload) {
          emitted.push({ rooms, event, payload });
        }
      };
    }
  };

  const result = emitRealtimeEnvelope({
    id: "event-2",
    event: "conversation:updated",
    room: "conversation:conversation-1",
    payload: { conversationId: "conversation-1" }
  }, fakeIo);

  assert.equal(result.emitted, true);
  assert.deepEqual(emitted[0].rooms, ["conversation:conversation-1"]);
  assert.equal(emitted[0].event, "conversation:updated");
});

test("frontend realtime handler keeps a message-id dedupe guard", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../frontend/src/contexts/SocketProvider.tsx"),
    "utf8"
  );

  assert.match(source, /cacheUpdatedMessageIds/);
  assert.match(source, /cacheUpdatedMessageIds\.has\(messageId\)/);
  assert.match(source, /cacheUpdatedMessageIds\.add\(messageId\)/);
});
