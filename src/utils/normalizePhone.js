const ApiError = require("./apiError");

function normalizePhone(input) {
  const phone = String(input || "").replace(/[^\d]/g, "");

  if (!phone) {
    throw new ApiError(400, "A valid phone number is required");
  }

  return phone;
}

function safeNormalizePhone(input) {
  try {
    return normalizePhone(input);
  } catch (error) {
    return null;
  }
}

function getPhoneLookupVariants(input) {
  const normalized = safeNormalizePhone(input);
  const raw = String(input || "").trim();
  const variants = new Set();

  if (normalized) {
    variants.add(normalized);
    variants.add(`+${normalized}`);
  }

  if (raw) {
    variants.add(raw);
  }

  return [...variants];
}

function maskPhone(input) {
  const value = safeNormalizePhone(input) || String(input || "");

  if (!value) {
    return null;
  }

  if (value.length <= 4) {
    return "****";
  }

  return `${"*".repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
}

module.exports = normalizePhone;
module.exports.normalizePhone = normalizePhone;
module.exports.safeNormalizePhone = safeNormalizePhone;
module.exports.getPhoneLookupVariants = getPhoneLookupVariants;
module.exports.maskPhone = maskPhone;
