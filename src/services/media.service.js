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
  document: "DOCUMENT"
};

function normalizeOutboundMediaType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return outboundTypeMap[normalized] || null;
}

function isMimeAllowedForType(mediaType, mimeType) {
  if (!mediaType || !mimeType || !allowedMimeTypes.has(mimeType)) {
    return false;
  }

  const key = mediaType.toLowerCase();
  const rules = typeMimePrefixes[key] || [];

  return rules.some((rule) => (
    rule.endsWith("/") ? mimeType.startsWith(rule) : mimeType === rule
  ));
}

function validateUploadedMedia({ mediaType, file }) {
  if (!file) {
    throw new ApiError(400, "Media file is required");
  }

  const messageType = normalizeOutboundMediaType(mediaType);

  if (!messageType) {
    throw new ApiError(400, "Invalid media type", [
      { allowedTypes: Object.keys(outboundTypeMap) }
    ]);
  }

  if (!isMimeAllowedForType(mediaType, file.mimetype)) {
    throw new ApiError(400, "File MIME type is not allowed for the requested media type", [
      {
        type: mediaType,
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
    mimeType: file.mimetype
  });

  return {
    messageType,
    mediaUrl: saved.mediaUrl,
    localPath: saved.localPath,
    fileName: sanitizeFileName(file.originalname),
    mimeType: file.mimetype,
    fileSize: file.size
  };
}

function extractInboundMedia(message) {
  if (!message || !message.type) {
    return null;
  }

  if (message.image) {
    return {
      messageType: "IMAGE",
      mediaId: message.image.id || null,
      mimeType: message.image.mime_type || null,
      caption: message.image.caption || null,
      fileName: null,
      fileSize: null,
      duration: null
    };
  }

  if (message.audio) {
    return {
      messageType: message.audio.voice ? "VOICE" : "AUDIO",
      mediaId: message.audio.id || null,
      mimeType: message.audio.mime_type || null,
      caption: null,
      fileName: null,
      fileSize: null,
      duration: null
    };
  }

  if (message.document) {
    return {
      messageType: "DOCUMENT",
      mediaId: message.document.id || null,
      mimeType: message.document.mime_type || null,
      caption: message.document.caption || null,
      fileName: message.document.filename ? sanitizeFileName(message.document.filename) : null,
      fileSize: null,
      duration: null
    };
  }

  return null;
}

async function downloadInboundMedia(media) {
  if (!media || !media.mediaId) {
    return media;
  }

  try {
    const downloaded = await whatsapp.downloadMedia(media.mediaId);
    const mimeType = downloaded.mimeType || media.mimeType;
    const fileSize = downloaded.fileSize || media.fileSize || downloaded.buffer.length;

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
      mimeType
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
  normalizeOutboundMediaType,
  validateUploadedMedia,
  saveUploadedMedia,
  extractInboundMedia,
  downloadInboundMedia
};
