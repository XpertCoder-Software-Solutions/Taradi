const AUTH_CODES = new Set([190]);
const RATE_CODES = new Set([4, 17, 32, 613, 80007]);
const ACCOUNT_CODES = new Set([131031, 131042, 131045, 131047]);
const TEMPLATE_CODES = new Set([132001, 132005, 132007, 132015, 132016]);
const RECIPIENT_CODES = new Set([131026, 131030, 131053, 132000]);

function metaDetails(error) {
  const body = error && error.details || error && error.response && error.response.data || {};
  const value = body.error || body;
  return {
    code: Number(value.code || error && error.code),
    subcode: Number(value.error_subcode),
    message: String(value.message || error && error.message || "WhatsApp campaign send failed"),
    retryAfterMs: Number(error && error.retryAfterMs || value.retry_after_ms || 0)
  };
}

function classifyCampaignError(error) {
  const details = metaDetails(error);
  const status = Number(error && (error.status || error.response && error.response.status));
  const message = details.message.toLowerCase();
  let category = "RETRYABLE";

  if (status === 429 || RATE_CODES.has(details.code)) category = "RATE_LIMIT";
  else if (status === 401 || AUTH_CODES.has(details.code) || message.includes("access token") || message.includes("oauth")) category = "AUTHENTICATION";
  else if (ACCOUNT_CODES.has(details.code) || ["disabled", "banned", "restricted", "permission"].some((term) => message.includes(term))) category = "PERMANENT_ACCOUNT";
  else if (TEMPLATE_CODES.has(details.code) || (message.includes("template") && ["paused", "disabled", "rejected", "not found"].some((term) => message.includes(term)))) category = "PERMANENT_TEMPLATE";
  else if (RECIPIENT_CODES.has(details.code) || (status >= 400 && status < 500)) category = "PERMANENT_RECIPIENT";

  return {
    ...details,
    category,
    permanent: category.startsWith("PERMANENT") || category === "AUTHENTICATION",
    retryable: category === "RETRYABLE" || category === "RATE_LIMIT"
  };
}

function retryDelayMs(attempt, retryAfterMs = 0) {
  if (retryAfterMs > 0) return retryAfterMs;
  const exponential = Math.min(30 * 60 * 1000, 10000 * (2 ** Math.max(0, attempt - 1)));
  return exponential + Math.floor(Math.random() * Math.max(1000, exponential * 0.2));
}

module.exports = { classifyCampaignError, retryDelayMs };
