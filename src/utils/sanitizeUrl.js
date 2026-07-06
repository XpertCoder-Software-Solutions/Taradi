const SENSITIVE_QUERY_KEYS = new Set([
  "hub.verify_token",
  "token",
  "access_token",
  "password",
  "authorization"
]);

function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl, "http://taradi.local");

    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return rawUrl;
  }
}

module.exports = sanitizeUrl;
