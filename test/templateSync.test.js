const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-with-at-least-32-chars";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-send-token";
process.env.WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "test-template-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "111111111111111";
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "222222222222222";
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "test-verify-token";
process.env.META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || "v23.0";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

const {
  buildMessageTemplatesRequest,
  fetchAllMessageTemplates
} = require("../src/services/whatsapp.service");
const {
  normalizeMetaTemplate,
  upsertTemplateFromMeta
} = require("../src/modules/templates/template.service");

function response(data, status = 200, headers = {}) {
  return { status, data, headers };
}

function metaError(status, code, message, subcode) {
  const error = new Error(message);
  error.response = {
    status,
    headers: { "x-fb-trace-id": "trace-test" },
    data: {
      error: {
        message,
        type: code === 190 ? "OAuthException" : "GraphMethodException",
        code,
        ...(subcode ? { error_subcode: subcode } : {})
      }
    }
  };
  return error;
}

function fakeHttpClient(sequence) {
  const calls = [];

  return {
    calls,
    async get(url, config) {
      calls.push({ url, config });
      const next = sequence.shift();

      if (next instanceof Error) {
        throw next;
      }

      return next;
    }
  };
}

function createTemplateDb(initial = []) {
  const rows = initial.map((row) => ({ ...row }));

  return {
    rows,
    whatsappTemplate: {
      async findFirst({ where }) {
        return rows.find((row) => where.OR.some((filter) => Object.entries(filter).every(([key, value]) => row[key] === value))) || null;
      },
      async update({ where, data }) {
        const row = where.id
          ? rows.find((item) => item.id === where.id)
          : rows.find((item) => item.name === where.name_language.name && item.language === where.name_language.language);

        Object.assign(row, data);
        return { ...row };
      },
      async create({ data }) {
        const row = { id: `template-${rows.length + 1}`, ...data };
        rows.push(row);
        return { ...row };
      }
    }
  };
}

test("builds the Meta WABA message_templates endpoint with required fields", () => {
  const request = buildMessageTemplatesRequest();

  assert.equal(request.url, `/${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`);
  assert.equal(request.params.limit, 100);
  assert.match(request.params.fields, /quality_score/);
  assert.match(request.params.fields, /rejected_reason/);
  assert.doesNotMatch(request.url, new RegExp(process.env.WHATSAPP_PHONE_NUMBER_ID));
});

test("fetches one page of Meta templates", async () => {
  const httpClient = fakeHttpClient([
    response({
      data: [{ id: "tpl-1", name: "hello", language: "ar", status: "APPROVED", components: [] }]
    })
  ]);

  const result = await fetchAllMessageTemplates({ httpClient, retryDelayMs: 0 });

  assert.equal(result.templates.length, 1);
  assert.equal(result.meta.pages, 1);
  assert.equal(result.meta.fetched, 1);
  assert.equal(httpClient.calls[0].config.params.limit, 100);
});

test("fetches multiple Meta template pages using paging.next", async () => {
  const httpClient = fakeHttpClient([
    response({
      data: [{ id: "tpl-1", name: "hello", language: "ar", status: "APPROVED", components: [] }],
      paging: { next: "https://graph.facebook.com/v23.0/222222222222222/message_templates?after=cursor-1" }
    }),
    response({
      data: [{ id: "tpl-2", name: "bye", language: "en_US", status: "PENDING", components: [] }]
    })
  ]);

  const result = await fetchAllMessageTemplates({ httpClient, retryDelayMs: 0 });

  assert.equal(result.templates.length, 2);
  assert.equal(result.meta.pages, 2);
  assert.equal(httpClient.calls[1].url, "https://graph.facebook.com/v23.0/222222222222222/message_templates?after=cursor-1");
});

test("handles an empty Meta template response", async () => {
  const httpClient = fakeHttpClient([
    response({ data: [] })
  ]);

  const result = await fetchAllMessageTemplates({ httpClient, retryDelayMs: 0 });

  assert.deepEqual(result.templates, []);
  assert.equal(result.meta.pages, 1);
  assert.equal(result.meta.fetched, 0);
});

test("does not retry invalid token errors", async () => {
  const httpClient = fakeHttpClient([
    metaError(400, 190, "Invalid OAuth access token.")
  ]);

  await assert.rejects(
    fetchAllMessageTemplates({ httpClient, retryDelayMs: 0 }),
    (error) => {
      assert.equal(error.details.category, "authentication");
      assert.equal(httpClient.calls.length, 1);
      return true;
    }
  );
});

test("returns a clear missing permissions error", async () => {
  const httpClient = fakeHttpClient([
    metaError(403, 10, "Application does not have permission for this action.")
  ]);

  await assert.rejects(
    fetchAllMessageTemplates({ httpClient, retryDelayMs: 0 }),
    (error) => {
      assert.equal(error.details.category, "permission");
      assert.match(error.message, /whatsapp_business_management/);
      assert.equal(httpClient.calls.length, 1);
      return true;
    }
  );
});

test("retries HTTP 429 template sync failures", async () => {
  const httpClient = fakeHttpClient([
    metaError(429, 613, "Calls to this api have exceeded the rate limit."),
    response({ data: [{ id: "tpl-1", name: "hello", language: "ar", status: "APPROVED", components: [] }] })
  ]);

  const result = await fetchAllMessageTemplates({ httpClient, retryDelayMs: 0 });

  assert.equal(result.templates.length, 1);
  assert.equal(httpClient.calls.length, 2);
});

test("retries Meta 5xx template sync failures", async () => {
  const httpClient = fakeHttpClient([
    metaError(500, 1, "Please reduce the amount of data you're asking for."),
    response({ data: [{ id: "tpl-1", name: "hello", language: "ar", status: "APPROVED", components: [] }] })
  ]);

  const result = await fetchAllMessageTemplates({ httpClient, retryDelayMs: 0 });

  assert.equal(result.templates.length, 1);
  assert.equal(httpClient.calls.length, 2);
});

test("upserts templates by Meta template id", async () => {
  const db = createTemplateDb([
    { id: "local-1", metaTemplateId: "tpl-1", name: "old", language: "ar" }
  ]);

  const result = await upsertTemplateFromMeta({
    id: "tpl-1",
    name: "new_name",
    language: "ar",
    status: "APPROVED",
    components: []
  }, db);

  assert.equal(result.action, "updated");
  assert.equal(db.rows[0].name, "new_name");
});

test("keeps same template name in different languages distinct", async () => {
  const db = createTemplateDb();

  await upsertTemplateFromMeta({ id: "tpl-ar", name: "payment_notice", language: "ar", status: "APPROVED", components: [] }, db);
  await upsertTemplateFromMeta({ id: "tpl-en", name: "payment_notice", language: "en_US", status: "APPROVED", components: [] }, db);

  assert.equal(db.rows.length, 2);
  assert.deepEqual(db.rows.map((row) => row.language).sort(), ["ar", "en_US"]);
});

test("normalizes non-approved templates without hiding them", () => {
  const template = normalizeMetaTemplate({
    id: "tpl-pending",
    name: "pending_template",
    language: "ar",
    status: "PENDING",
    category: "MARKETING",
    quality_score: { score: "UNKNOWN" },
    rejected_reason: null,
    components: []
  });

  assert.equal(template.status, "PENDING");
  assert.equal(template.isActive, true);
  assert.deepEqual(template.qualityScore, { score: "UNKNOWN" });
});
