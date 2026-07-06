const path = require("path");
const env = require("./env");

const uploadRoot = path.join(__dirname, "..", "..", "uploads");
const whatsappUploadDir = path.join(uploadRoot, "whatsapp");

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

const typeMimePrefixes = {
  image: ["image/"],
  audio: ["audio/"],
  voice: ["audio/"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ]
};

module.exports = {
  uploadRoot,
  whatsappUploadDir,
  maxUploadBytes: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
  allowedMimeTypes,
  typeMimePrefixes
};
