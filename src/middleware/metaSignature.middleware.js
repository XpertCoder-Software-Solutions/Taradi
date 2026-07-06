const crypto = require("crypto");
const env = require("../config/env");
const ApiError = require("../utils/apiError");

function getSignatureBuffer(signature) {
  if (!signature || typeof signature !== "string") {
    return null;
  }

  const [algorithm, digest] = signature.split("=");

  if (algorithm !== "sha256" || !digest) {
    return null;
  }

  try {
    return Buffer.from(digest, "hex");
  } catch (error) {
    return null;
  }
}

function verifyMetaSignature(req, res, next) {
  if (!env.VERIFY_META_SIGNATURE) {
    return next();
  }

  if (!env.META_APP_SECRET) {
    return next(new ApiError(401, "Meta signature verification is enabled but META_APP_SECRET is not configured"));
  }

  const receivedSignature = getSignatureBuffer(req.headers["x-hub-signature-256"]);

  if (!receivedSignature || !req.rawBody) {
    return next(new ApiError(401, "Missing Meta signature"));
  }

  const expectedDigest = crypto
    .createHmac("sha256", env.META_APP_SECRET)
    .update(req.rawBody)
    .digest("hex");
  const expectedSignature = Buffer.from(expectedDigest, "hex");

  if (
    receivedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return next(new ApiError(401, "Invalid Meta signature"));
  }

  return next();
}

module.exports = verifyMetaSignature;
