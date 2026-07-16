const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-with-at-least-32-chars";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-whatsapp-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "test-phone-number-id";
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "test-business-account-id";
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "test-verify-token";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

const audioNormalization = require("../src/services/audioNormalization.service");
const whatsapp = require("../src/services/whatsapp.service");
const outboundService = require("../src/services/outbound.service");

async function makeTempFile(extension = ".webm") {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "taradi-audio-test-"));
  const filePath = path.join(dir, `input${extension}`);
  await fs.promises.writeFile(filePath, Buffer.from("test-audio"));

  return { dir, filePath };
}

function installSuccessfulFfmpegStub(calls = []) {
  audioNormalization._setFfmpegRunnerForTests(async (args) => {
    calls.push(args);

    if (args.includes("-version")) {
      return { stderr: "" };
    }

    const outputPath = args[args.length - 1];
    await fs.promises.writeFile(outputPath, Buffer.from("converted-ogg"));
    return { stderr: "" };
  });
}

test.afterEach(() => {
  audioNormalization._resetFfmpegAvailabilityForTests();
});

test("audio/webm is converted to OGG/Opus with the expected command", async () => {
  const { dir, filePath } = await makeTempFile(".webm");
  const calls = [];
  installSuccessfulFfmpegStub(calls);

  const normalized = await audioNormalization.normalizeOutboundAudio({
    filePath,
    fileName: "../voice.webm",
    mimeType: "audio/webm"
  });

  const conversionArgs = calls.find((args) => args.includes("-c:a"));
  assert.equal(normalized.converted, true);
  assert.equal(normalized.mimeType, "audio/ogg");
  assert.match(normalized.fileName, /\.ogg$/);
  assert.equal(path.basename(normalized.fileName), normalized.fileName);
  assert.deepEqual(conversionArgs.slice(conversionArgs.indexOf("-vn"), conversionArgs.indexOf("-f") + 2), [
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "libopus",
    "-b:a",
    "32k",
    "-f",
    "ogg"
  ]);

  await audioNormalization.cleanupNormalizedAudio(normalized);
  assert.equal(fs.existsSync(normalized.filePath), false);
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test("audio/webm with opus codec parameter is converted", async () => {
  const { dir, filePath } = await makeTempFile(".webm");
  installSuccessfulFfmpegStub();

  const normalized = await audioNormalization.normalizeOutboundAudio({
    filePath,
    fileName: "voice.webm",
    mimeType: "audio/webm;codecs=opus"
  });

  assert.equal(normalized.converted, true);
  assert.equal(normalized.mimeType, "audio/ogg");
  assert.match(normalized.fileName, /\.ogg$/);

  await audioNormalization.cleanupNormalizedAudio(normalized);
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test("audio/ogg bypasses conversion", async () => {
  const { dir, filePath } = await makeTempFile(".ogg");
  audioNormalization._setFfmpegRunnerForTests(async () => {
    throw new Error("ffmpeg should not be called");
  });

  const normalized = await audioNormalization.normalizeOutboundAudio({
    filePath,
    fileName: "voice.ogg",
    mimeType: "audio/ogg"
  });

  assert.equal(normalized.converted, false);
  assert.equal(normalized.filePath, filePath);
  assert.equal(normalized.mimeType, "audio/ogg");
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test("audio/opus bypasses conversion", async () => {
  const { dir, filePath } = await makeTempFile(".opus");
  audioNormalization._setFfmpegRunnerForTests(async () => {
    throw new Error("ffmpeg should not be called");
  });

  const normalized = await audioNormalization.normalizeOutboundAudio({
    filePath,
    fileName: "voice.opus",
    mimeType: "audio/opus"
  });

  assert.equal(normalized.converted, false);
  assert.equal(normalized.filePath, filePath);
  assert.equal(normalized.mimeType, "audio/opus");
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test("supported AAC, MP4, MPEG, and AMR audio bypass conversion", async () => {
  const supportedTypes = ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr"];
  audioNormalization._setFfmpegRunnerForTests(async () => {
    throw new Error("ffmpeg should not be called");
  });

  for (const mimeType of supportedTypes) {
    const { dir, filePath } = await makeTempFile(".audio");
    const normalized = await audioNormalization.normalizeOutboundAudio({
      filePath,
      fileName: "voice.audio",
      mimeType
    });

    assert.equal(normalized.converted, false);
    assert.equal(normalized.mimeType, mimeType);
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("ffmpeg unavailable produces a controlled permanent failure", async () => {
  audioNormalization._setFfmpegRunnerForTests(async () => {
    const error = new Error("spawn ffmpeg ENOENT");
    error.code = "ENOENT";
    throw error;
  });

  await assert.rejects(
    () => audioNormalization.normalizeOutboundAudio({
      filePath: "/tmp/missing.webm",
      fileName: "voice.webm",
      mimeType: "audio/webm"
    }),
    (error) => {
      assert.equal(error.code, "FFMPEG_UNAVAILABLE");
      assert.equal(error.permanent, true);
      return true;
    }
  );
});

test("conversion failure is permanent and removes the converted temp directory", async () => {
  const { dir, filePath } = await makeTempFile(".webm");
  let outputPath;

  audioNormalization._setFfmpegRunnerForTests(async (args) => {
    if (args.includes("-version")) {
      return { stderr: "" };
    }

    outputPath = args[args.length - 1];
    await fs.promises.writeFile(outputPath, Buffer.from("partial-output"));
    throw new Error("invalid media");
  });

  await assert.rejects(
    () => audioNormalization.normalizeOutboundAudio({
      filePath,
      fileName: "voice.webm",
      mimeType: "audio/webm"
    }),
    (error) => {
      assert.equal(error.code, "OUTBOUND_AUDIO_CONVERSION_FAILED");
      assert.equal(error.permanent, true);
      return true;
    }
  );

  assert.equal(fs.existsSync(path.dirname(outputPath)), false);
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test("Meta upload receives the converted voice file and send payload uses returned media id", async () => {
  const { dir, filePath } = await makeTempFile(".webm");
  const originalUpload = whatsapp.uploadMedia;
  const originalSendAudio = whatsapp.sendAudioMessage;
  let uploadedFile;
  let sendAudioArgs;

  installSuccessfulFfmpegStub();
  whatsapp.uploadMedia = async (file) => {
    uploadedFile = file;
    assert.equal(fs.existsSync(file.localPath), true);
    return { id: "meta-media-1" };
  };
  whatsapp.sendAudioMessage = async (to, mediaId) => {
    sendAudioArgs = { to, mediaId };
    return { messages: [{ id: "wamid-1" }] };
  };

  try {
    const result = await outboundService._sendQueuedMessageForTests({
      id: "message-voice-1",
      customerId: "customer-1",
      type: "VOICE",
      mediaId: null,
      mediaUrl: "/uploads/whatsapp/voice.webm",
      fileName: "voice.webm",
      mimeType: "audio/webm",
      fileSize: 10,
      rawPayload: { localPath: filePath },
      customer: {
        phone: "966500000001",
        collectionStatus: "ACTIVE_DEBT",
        phones: [{ phoneNumber: "966500000001", isPrimary: true }]
      }
    });

    assert.equal(uploadedFile.mimeType, "audio/ogg");
    assert.match(uploadedFile.fileName, /\.ogg$/);
    assert.equal(sendAudioArgs.mediaId, "meta-media-1");
    assert.equal(result.mediaId, "meta-media-1");
    assert.equal(fs.existsSync(uploadedFile.localPath), false);
    assert.equal(fs.existsSync(filePath), true);
  } finally {
    whatsapp.uploadMedia = originalUpload;
    whatsapp.sendAudioMessage = originalSendAudio;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("converted temp file is deleted when Meta upload fails", async () => {
  const { dir, filePath } = await makeTempFile(".webm");
  const originalUpload = whatsapp.uploadMedia;
  let uploadedPath;

  installSuccessfulFfmpegStub();
  whatsapp.uploadMedia = async (file) => {
    uploadedPath = file.localPath;
    assert.equal(fs.existsSync(uploadedPath), true);
    const error = new Error("Meta rejected media");
    error.status = 400;
    throw error;
  };

  try {
    await assert.rejects(() => outboundService._sendQueuedMessageForTests({
      id: "message-voice-2",
      customerId: "customer-1",
      type: "VOICE",
      mediaId: null,
      mediaUrl: "/uploads/whatsapp/voice.webm",
      fileName: "voice.webm",
      mimeType: "audio/webm",
      fileSize: 10,
      rawPayload: { localPath: filePath },
      customer: {
        phone: "966500000001",
        collectionStatus: "ACTIVE_DEBT",
        phones: [{ phoneNumber: "966500000001", isPrimary: true }]
      }
    }), /Meta rejected media/);

    assert.equal(fs.existsSync(uploadedPath), false);
  } finally {
    whatsapp.uploadMedia = originalUpload;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("Meta audio send helper sends an audio payload with the uploaded media id", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/whatsapp.service.js"), "utf8");

  assert.match(source, /type: "audio"/);
  assert.match(source, /audio: \{\s+id: mediaId\s+\}/);
});

test("outbound retries use the existing queued message path without creating duplicates", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/outbound.service.js"), "utf8");

  assert.match(source, /async function processQueuedOutboundMessage\(messageId/);
  assert.match(source, /const message = await getOutboundMessage\(messageId\)/);
  assert.doesNotMatch(source, /prisma\.message\.create\(/);
  assert.match(source, /status: "FAILED"/);
});

test("original inbound media playback path remains unchanged", () => {
  const mediaService = fs.readFileSync(path.join(__dirname, "../src/services/media.service.js"), "utf8");
  const conversationService = fs.readFileSync(path.join(__dirname, "../src/services/conversation.service.js"), "utf8");
  const messageBubble = fs.readFileSync(path.join(__dirname, "../frontend/src/components/inbox/MessageBubble.tsx"), "utf8");

  assert.match(mediaService, /async function downloadInboundMedia/);
  assert.doesNotMatch(mediaService, /normalizeOutboundAudio/);
  assert.match(conversationService, /mediaUrl: message\.mediaUrl/);
  assert.match(messageBubble, /messageMediaEndpoint\(message\.id\)/);
});
