const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { whatsappUploadDir } = require("../config/media");

const extensionByMimeType = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx"
};

function ensureUploadDirectory() {
  fs.mkdirSync(whatsappUploadDir, { recursive: true });
}

function sanitizeFileName(fileName) {
  const baseName = path.basename(String(fileName || "media"));

  return baseName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120) || "media";
}

function extensionFor(fileName, mimeType) {
  const ext = path.extname(sanitizeFileName(fileName)).toLowerCase();

  if (ext) {
    return ext;
  }

  return extensionByMimeType[mimeType] || "";
}

function createStoredFileName({ originalName, mimeType }) {
  const ext = extensionFor(originalName, mimeType);
  return `${Date.now()}-${crypto.randomUUID()}${ext}`;
}

function mediaUrlForFileName(fileName) {
  return `/uploads/whatsapp/${fileName}`;
}

function pathFromMediaUrl(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== "string") {
    return null;
  }

  const prefix = "/uploads/whatsapp/";

  if (!mediaUrl.startsWith(prefix)) {
    return null;
  }

  return path.join(whatsappUploadDir, path.basename(mediaUrl));
}

async function saveMediaBuffer(buffer, { originalName, mimeType }) {
  ensureUploadDirectory();

  const fileName = createStoredFileName({ originalName, mimeType });
  const localPath = path.join(whatsappUploadDir, fileName);

  await fs.promises.writeFile(localPath, buffer, { flag: "wx" });

  return {
    localPath,
    mediaUrl: mediaUrlForFileName(fileName),
    storedFileName: fileName,
    originalFileName: sanitizeFileName(originalName)
  };
}

module.exports = {
  ensureUploadDirectory,
  sanitizeFileName,
  saveMediaBuffer,
  pathFromMediaUrl
};
