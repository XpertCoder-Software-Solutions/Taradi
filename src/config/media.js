const path = require("path");
const env = require("./env");

const uploadRoot = path.join(process.cwd(), "uploads");
const whatsappUploadDir = path.join(uploadRoot, "whatsapp");
const whatsappInboundUploadDir = path.join(whatsappUploadDir, "inbound");

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/3gpp",
  "audio/aac",
  "audio/amr",
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/wav",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);

const typeMimePrefixes = {
  image: ["image/"],
  video: ["video/"],
  audio: ["audio/"],
  voice: ["audio/"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ],
  sticker: ["image/webp"]
};

module.exports = {
  uploadRoot,
  whatsappUploadDir,
  whatsappInboundUploadDir,
  maxUploadBytes: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
  allowedMimeTypes,
  typeMimePrefixes
};
