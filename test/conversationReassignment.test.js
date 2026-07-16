const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-with-at-least-32-chars";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-whatsapp-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "test-phone-number-id";
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "test-business-account-id";
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "test-verify-token";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

const {
  reassignCustomerConversationInTransaction
} = require("../src/services/conversation.service");

function createFakeTransaction(overrides = {}) {
  const state = {
    customer: {
      id: "customer-1",
      assignedToId: "employee-old",
      tags: ["vip"],
      assignedTo: {
        id: "employee-old",
        name: "أحمد",
        role: "EMPLOYEE",
        supervisorId: null,
        isActive: true
      },
      ...(overrides.customer || {})
    },
    conversations: overrides.conversations || [
      {
        id: "conversation-old",
        customerId: "customer-1",
        activeKey: "customer-1",
        assignedEmployeeId: "employee-old",
        assignedEmployee: {
          id: "employee-old",
          name: "أحمد",
          role: "EMPLOYEE",
          supervisorId: null,
          isActive: true
        },
        status: "OPEN",
        unreadCount: 2,
        tags: ["vip"]
      }
    ],
    messages: overrides.messages || [
      {
        id: "message-existing",
        customerId: "customer-1",
        conversationId: "conversation-old",
        body: "old message"
      }
    ],
    histories: []
  };

  const tx = {
    state,
    customer: {
      async findUnique() {
        return state.customer;
      },
      async update({ data }) {
        Object.assign(state.customer, data);
        return state.customer;
      }
    },
    conversation: {
      async findMany({ where }) {
        return state.conversations.filter((conversation) => (
          conversation.customerId === where.customerId &&
          conversation.activeKey === where.activeKey
        ));
      },
      async update({ where, data }) {
        const conversation = state.conversations.find((item) => item.id === where.id);
        Object.assign(conversation, data);
        return conversation;
      },
      async create({ data }) {
        const conversation = {
          id: `conversation-${state.conversations.length + 1}`,
          ...data
        };
        state.conversations.push(conversation);
        return conversation;
      },
      async upsert({ where, update, create }) {
        let conversation = state.conversations.find((item) => item.activeKey === where.activeKey);

        if (conversation) {
          Object.assign(conversation, update);
          return conversation;
        }

        conversation = {
          id: `conversation-${state.conversations.length + 1}`,
          ...create
        };
        state.conversations.push(conversation);
        return conversation;
      }
    },
    message: {
      async create({ data }) {
        const message = {
          id: `message-${state.messages.length + 1}`,
          ...data
        };
        state.messages.push(message);
        return message;
      }
    },
    conversationAssignmentHistory: {
      async create({ data }) {
        const row = {
          id: `history-${state.histories.length + 1}`,
          ...data
        };
        state.histories.push(row);
        return row;
      }
    }
  };

  return tx;
}

test("reassigns to a different employee by archiving the old conversation and creating one active conversation", async () => {
  const tx = createFakeTransaction();
  const result = await reassignCustomerConversationInTransaction(tx, {
    customerId: "customer-1",
    newAssigneeId: "employee-new",
    actor: { id: "admin-1", name: "المدير" },
    reason: "توزيع جديد",
    newAssignee: { id: "employee-new", name: "محمد" }
  });

  const archived = tx.state.conversations.find((conversation) => conversation.id === "conversation-old");
  const active = tx.state.conversations.find((conversation) => conversation.activeKey === "customer-1");

  assert.equal(result.archivedConversationId, "conversation-old");
  assert.equal(result.activeConversationId, active.id);
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(archived.activeKey, null);
  assert.equal(archived.previousAssigneeId, "employee-old");
  assert.equal(archived.reassignedToId, "employee-new");
  assert.equal(active.assignedEmployeeId, "employee-new");
  assert.equal(tx.state.customer.assignedToId, "employee-new");
  assert.equal(tx.state.histories.length, 1);
  assert.equal(tx.state.histories[0].previousAssigneeId, "employee-old");
  assert.equal(tx.state.histories[0].newAssigneeId, "employee-new");
});

test("preserves old messages on the archived conversation", async () => {
  const tx = createFakeTransaction();

  await reassignCustomerConversationInTransaction(tx, {
    customerId: "customer-1",
    newAssigneeId: "employee-new",
    actor: { id: "admin-1", name: "المدير" },
    newAssignee: { id: "employee-new", name: "محمد" }
  });

  const oldMessage = tx.state.messages.find((message) => message.id === "message-existing");

  assert.equal(oldMessage.conversationId, "conversation-old");
  assert.equal(tx.state.messages.filter((message) => message.id === "message-existing").length, 1);
});

test("assigning to the same employee is idempotent and does not archive or duplicate", async () => {
  const tx = createFakeTransaction();
  const result = await reassignCustomerConversationInTransaction(tx, {
    customerId: "customer-1",
    newAssigneeId: "employee-old",
    actor: { id: "admin-1", name: "المدير" },
    newAssignee: { id: "employee-old", name: "أحمد" }
  });

  assert.equal(result.sameAssignment, true);
  assert.equal(result.archivedConversationId, null);
  assert.equal(tx.state.conversations.length, 1);
  assert.equal(tx.state.histories.length, 0);
  assert.equal(tx.state.conversations[0].status, "OPEN");
});

test("creates an active conversation when reassignment finds no active conversation", async () => {
  const tx = createFakeTransaction({ conversations: [] });
  const result = await reassignCustomerConversationInTransaction(tx, {
    customerId: "customer-1",
    newAssigneeId: "employee-new",
    actor: { id: "admin-1", name: "المدير" },
    newAssignee: { id: "employee-new", name: "محمد" }
  });

  assert.equal(result.archivedConversationId, null);
  assert.equal(tx.state.conversations.length, 1);
  assert.equal(tx.state.conversations[0].activeKey, "customer-1");
  assert.equal(tx.state.conversations[0].assignedEmployeeId, "employee-new");
  assert.equal(tx.state.histories.length, 1);
});

test("refuses reassignment when legacy data has multiple active conversations", async () => {
  const tx = createFakeTransaction({
    conversations: [
      { id: "conversation-a", customerId: "customer-1", activeKey: "customer-1", assignedEmployeeId: "employee-old", status: "OPEN" },
      { id: "conversation-b", customerId: "customer-1", activeKey: "customer-1", assignedEmployeeId: "employee-old", status: "OPEN" }
    ]
  });

  await assert.rejects(
    reassignCustomerConversationInTransaction(tx, {
      customerId: "customer-1",
      newAssigneeId: "employee-new",
      actor: { id: "admin-1", name: "المدير" },
      newAssignee: { id: "employee-new", name: "محمد" }
    }),
    /أكثر من محادثة نشطة/
  );
});
