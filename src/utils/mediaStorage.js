const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { whatsappUploadDir, whatsappInboundUploadDir } = require("../config/media");

const extensionByMimeType = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "audio/aac": ".aac",
  "audio/amr": ".amr",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/webm": ".webm",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx"
};

function ensureUploadDirectory() {
  fs.mkdirSync(whatsappUploadDir, { recursive: true });
  fs.mkdirSync(whatsappInboundUploadDir, { recursive: true });
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

function getUploadDirectory(subDir) {
  if (!subDir) {
    return whatsappUploadDir;
  }

  const safeSubDir = path.basename(String(subDir));

  if (safeSubDir !== subDir) {
    throw new Error("Invalid upload subdirectory");
  }

  return path.join(whatsappUploadDir, safeSubDir);
}

function mediaUrlForFileName(fileName, subDir) {
  return `/uploads/whatsapp/${subDir ? `${subDir}/` : ""}${fileName}`;
}

function pathFromMediaUrl(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== "string") {
    return null;
  }

  const prefix = "/uploads/whatsapp/";

  if (!mediaUrl.startsWith(prefix)) {
    return null;
  }

  const rawRelative = mediaUrl.slice(prefix.length).split("?")[0].split("#")[0];
  let relativePath = rawRelative;

  try {
    relativePath = decodeURIComponent(rawRelative);
  } catch (error) {
    relativePath = rawRelative;
  }

  const normalizedRelative = path.normalize(relativePath);

  if (
    path.isAbsolute(normalizedRelative) ||
    normalizedRelative === "." ||
    normalizedRelative.startsWith("..")
  ) {
    return null;
  }

  const root = path.resolve(whatsappUploadDir);
  const resolved = path.resolve(root, normalizedRelative);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return resolved;
}

async function saveMediaBuffer(buffer, { originalName, mimeType, subDir = null }) {
  ensureUploadDirectory();

  const fileName = createStoredFileName({ originalName, mimeType });
  const uploadDirectory = getUploadDirectory(subDir);

  await fs.promises.mkdir(uploadDirectory, { recursive: true });

  const localPath = path.join(uploadDirectory, fileName);

  await fs.promises.writeFile(localPath, buffer, { flag: "wx" });

  return {
    localPath,
    mediaUrl: mediaUrlForFileName(fileName, subDir),
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
