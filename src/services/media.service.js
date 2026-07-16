const logger = require("../config/logger");
const { allowedMimeTypes, typeMimePrefixes } = require("../config/media");
const whatsapp = require("./whatsapp.service");
const ApiError = require("../utils/apiError");
const {
  sanitizeFileName,
  saveMediaBuffer
} = require("../utils/mediaStorage");

const outboundTypeMap = {
  image: "IMAGE",
  audio: "AUDIO",
  voice: "VOICE",
  video: "VIDEO",
  document: "DOCUMENT"
};

function normalizeOutboundMediaType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return outboundTypeMap[normalized] || null;
}

function normalizeMimeType(mimeType) {
  return String(mimeType || "").split(";")[0].trim().toLowerCase() || null;
}

function inferOutboundMediaType(file) {
  const mimeType = normalizeMimeType(file && file.mimetype);

  if (!mimeType) {
    return null;
  }

  if (mimeType.startsWith("image/")) {
    return "IMAGE";
  }

  if (mimeType.startsWith("video/")) {
    return "VIDEO";
  }

  if (mimeType.startsWith("audio/")) {
    return "AUDIO";
  }

  if (typeMimePrefixes.document.some((rule) => mimeType === rule)) {
    return "DOCUMENT";
  }

  return null;
}

function isMimeAllowedForType(mediaType, mimeType) {
  const normalizedMimeType = normalizeMimeType(mimeType);

  if (!mediaType || !normalizedMimeType || !allowedMimeTypes.has(normalizedMimeType)) {
    return false;
  }

  const key = mediaType.toLowerCase();
  const rules = typeMimePrefixes[key] || [];

  return rules.some((rule) => (
    rule.endsWith("/") ? normalizedMimeType.startsWith(rule) : normalizedMimeType === rule
  ));
}

function validateUploadedMedia({ mediaType, file }) {
  if (!file) {
    throw new ApiError(400, "Media file is required");
  }

  const messageType = normalizeOutboundMediaType(mediaType) || inferOutboundMediaType(file);

  if (!messageType) {
    throw new ApiError(400, "Invalid media type", [
      { allowedTypes: Object.keys(outboundTypeMap) }
    ]);
  }

  if (!isMimeAllowedForType(messageType, file.mimetype)) {
    throw new ApiError(400, "File MIME type is not allowed for the requested media type", [
      {
        type: mediaType || messageType.toLowerCase(),
        mimeType: file.mimetype
      }
    ]);
  }

  return messageType;
}

async function saveUploadedMedia({ mediaType, file }) {
  const messageType = validateUploadedMedia({ mediaType, file });
  const saved = await saveMediaBuffer(file.buffer, {
    originalName: file.originalname,
    mimeType: normalizeMimeType(file.mimetype)
  });

  return {
    messageType,
    mediaUrl: saved.mediaUrl,
    localPath: saved.localPath,
    fileName: sanitizeFileName(file.originalname),
    mimeType: normalizeMimeType(file.mimetype),
    fileSize: file.size
  };
}

function toPositiveInt(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function getInboundFileSize(payload) {
  return toPositiveInt(
    payload && (payload.file_size || payload.fileSize || payload.size)
  );
}

function getInboundDuration(payload) {
  return toPositiveInt(payload && payload.duration);
}

function buildInboundMedia(messageType, payload, overrides = {}) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    messageType,
    mediaId: payload.id || null,
    mimeType: normalizeMimeType(payload.mime_type || payload.mimeType),
    caption: payload.caption || null,
    fileName: payload.filename ? sanitizeFileName(payload.filename) : null,
    fileSize: getInboundFileSize(payload),
    duration: getInboundDuration(payload),
    ...overrides
  };
}

function extractInboundMedia(message) {
  if (!message || !message.type) {
    return null;
  }

  if (message.image) {
    return buildInboundMedia("IMAGE", message.image, {
      fileName: null
    });
  }

  if (message.audio) {
    return buildInboundMedia(message.audio.voice ? "VOICE" : "AUDIO", message.audio, {
      caption: null,
      fileName: null
    });
  }

  if (message.voice) {
    return buildInboundMedia("VOICE", message.voice, {
      caption: null,
      fileName: null
    });
  }

  if (message.video) {
    return buildInboundMedia("VIDEO", message.video, {
      fileName: null
    });
  }

  if (message.document) {
    return buildInboundMedia("DOCUMENT", message.document);
  }

  if (message.sticker) {
    return buildInboundMedia("STICKER", message.sticker, {
      caption: null,
      fileName: null
    });
  }

  return null;
}

async function downloadInboundMedia(media) {
  if (!media || !media.mediaId) {
    return media;
  }

  try {
    logger.debugStep("Downloading inbound WhatsApp media", {
      mediaId: media.mediaId,
      messageType: media.messageType,
      mimeType: media.mimeType || null
    });

    const downloaded = await whatsapp.downloadMedia(media.mediaId);
    const mimeType = normalizeMimeType(downloaded.mimeType || media.mimeType);
    const fileSize = Number(downloaded.fileSize) || Number(media.fileSize) || downloaded.buffer.length;

    if (!allowedMimeTypes.has(mimeType)) {
      logger.warn({
        mediaId: media.mediaId,
        mimeType
      }, "Skipping local save for unsupported inbound WhatsApp media MIME type");

      return {
        ...media,
        mimeType,
        fileSize
      };
    }

    const saved = await saveMediaBuffer(downloaded.buffer, {
      originalName: media.fileName || media.mediaId,
      mimeType,
      subDir: "inbound"
    });

    logger.debugStep("Saved inbound WhatsApp media locally", {
      mediaId: media.mediaId,
      messageType: media.messageType,
      mimeType,
      fileSize,
      localPath: saved.localPath,
      mediaUrl: saved.mediaUrl
    });

    return {
      ...media,
      mediaUrl: saved.mediaUrl,
      localPath: saved.localPath,
      mimeType,
      fileSize,
      fileName: media.fileName || saved.originalFileName
    };
  } catch (error) {
    logger.warn({
      err: error,
      mediaId: media.mediaId
    }, "Could not download inbound WhatsApp media; storing metadata only");

    return media;
  }
}

module.exports = {
  inferOutboundMediaType,
  normalizeOutboundMediaType,
  validateUploadedMedia,
  saveUploadedMedia,
  extractInboundMedia,
  downloadInboundMedia
};
