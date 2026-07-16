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
  getInboundContent,
  unsupportedInboundMessageBody
} = require("../src/services/webhook.service");
const { extractInboundMedia } = require("../src/services/media.service");
const otpWebhookEvent = require("./fixtures/whatsapp-otp-webhook-event.json");

function getFirstWebhookMessage(payload) {
  return payload.entry[0].changes[0].value.messages[0];
}

test("uses friendly Arabic body for the real unsupported OTP webhook payload", () => {
  const message = getFirstWebhookMessage(otpWebhookEvent);

  assert.equal(message.type, "unsupported");
  assert.deepEqual(Object.keys(message), [
    "id",
    "from",
    "type",
    "errors",
    "timestamp",
    "unsupported",
    "from_user_id"
  ]);
  assert.equal(message.unsupported.type, "unknown");
  assert.equal(getInboundContent(message), unsupportedInboundMessageBody);
  assert.notEqual(getInboundContent(message), "Message type unknown");
});

test("extracts normal inbound text body", () => {
  assert.equal(
    getInboundContent({
      type: "text",
      text: { body: "أهلًا بك" }
    }),
    "أهلًا بك"
  );
});

test("extracts button text and falls back to payload", () => {
  assert.equal(
    getInboundContent({
      type: "button",
      button: { text: "تأكيد", payload: "CONFIRM" }
    }),
    "تأكيد"
  );

  assert.equal(
    getInboundContent({
      type: "button",
      button: { payload: "CONFIRM" }
    }),
    "CONFIRM"
  );
});

test("extracts selected interactive reply title", () => {
  assert.equal(
    getInboundContent({
      type: "interactive",
      interactive: {
        type: "list_reply",
        list_reply: {
          id: "pay-now",
          title: "الدفع الآن",
          description: "اختيار الدفع"
        }
      }
    }),
    "الدفع الآن"
  );
});

test("keeps media captions and leaves no-caption media body empty", () => {
  assert.equal(
    getInboundContent({
      type: "image",
      image: { caption: "صورة العداد" }
    }),
    "صورة العداد"
  );

  assert.equal(
    getInboundContent({
      type: "audio",
      audio: { id: "audio-id" }
    }),
    null
  );

  assert.equal(
    getInboundContent({
      type: "document",
      document: { filename: "invoice.pdf" }
    }),
    null
  );

  assert.equal(
    getInboundContent({
      type: "sticker",
      sticker: { id: "sticker-id" }
    }),
    null
  );
});

test("extracts inbound WhatsApp media metadata by type", () => {
  assert.deepEqual(
    extractInboundMedia({
      type: "image",
      image: { id: "image-id", mime_type: "image/jpeg", caption: "صورة العداد" }
    }),
    {
      messageType: "IMAGE",
      mediaId: "image-id",
      mimeType: "image/jpeg",
      caption: "صورة العداد",
      fileName: null,
      fileSize: null,
      duration: null
    }
  );

  assert.deepEqual(
    extractInboundMedia({
      type: "video",
      video: { id: "video-id", mime_type: "video/mp4", caption: "فيديو", duration: 9 }
    }),
    {
      messageType: "VIDEO",
      mediaId: "video-id",
      mimeType: "video/mp4",
      caption: "فيديو",
      fileName: null,
      fileSize: null,
      duration: 9
    }
  );

  assert.deepEqual(
    extractInboundMedia({
      type: "audio",
      audio: { id: "voice-id", mime_type: "audio/ogg", voice: true, duration: 4 }
    }),
    {
      messageType: "VOICE",
      mediaId: "voice-id",
      mimeType: "audio/ogg",
      caption: null,
      fileName: null,
      fileSize: null,
      duration: 4
    }
  );

  assert.deepEqual(
    extractInboundMedia({
      type: "document",
      document: { id: "doc-id", mime_type: "application/pdf", filename: "invoice.pdf", caption: "فاتورة", file_size: 2048 }
    }),
    {
      messageType: "DOCUMENT",
      mediaId: "doc-id",
      mimeType: "application/pdf",
      caption: "فاتورة",
      fileName: "invoice.pdf",
      fileSize: 2048,
      duration: null
    }
  );

  assert.deepEqual(
    extractInboundMedia({
      type: "sticker",
      sticker: { id: "sticker-id", mime_type: "image/webp" }
    }),
    {
      messageType: "STICKER",
      mediaId: "sticker-id",
      mimeType: "image/webp",
      caption: null,
      fileName: null,
      fileSize: null,
      duration: null
    }
  );
});

test("recovers readable text from unknown message shapes", () => {
  assert.equal(
    getInboundContent({
      timestamp: "1783456836",
      custom: {
        body: "نص قابل للقراءة"
      }
    }),
    "نص قابل للقراءة"
  );

  assert.equal(
    getInboundContent({
      type: "unknown",
      errors: [{ message: "Message type unknown" }]
    }),
    unsupportedInboundMessageBody
  );
});

test("extracts readable text from system and referral payloads", () => {
  assert.equal(
    getInboundContent({
      type: "system",
      system: { body: "تم تغيير حالة المحادثة" }
    }),
    "تم تغيير حالة المحادثة"
  );

  assert.equal(
    getInboundContent({
      type: "referral",
      referral: { body: "رسالة إحالة" }
    }),
    "رسالة إحالة"
  );
});
