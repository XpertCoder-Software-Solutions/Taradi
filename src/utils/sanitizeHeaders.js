const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-hub-signature",
  "x-hub-signature-256"
]);

function sanitizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value
    ])
  );
}

module.exports = sanitizeHeaders;
