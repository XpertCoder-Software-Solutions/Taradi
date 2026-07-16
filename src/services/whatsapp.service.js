const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const env = require("../config/env");
const logger = require("../config/logger");
const ApiError = require("../utils/apiError");

const GRAPH_API_BASE_URL = `https://graph.facebook.com/${env.META_API_VERSION}`;
const TEMPLATE_TOKEN_ENV_CANDIDATES = ["WHATSAPP_ACCESS_TOKEN", "SYSTEM_USER_TOKEN", "WHATSAPP_TOKEN"];
const TEMPLATE_FIELDS = [
  "id",
  "name",
  "status",
  "category",
  "language",
  "components",
  "quality_score",
  "rejected_reason"
];
const TEMPLATE_PAGE_LIMIT = 100;
const TEMPLATE_MAX_ATTEMPTS = 3;
const TEMPLATE_RETRY_DELAY_MS = 250;
const SENSITIVE_QUERY_KEYS = new Set(["access_token", "authorization", "password", "token"]);

const client = axios.create({
  baseURL: GRAPH_API_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json"
  }
});

client.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  config.headers.Authorization = getWhatsAppAuthorizationHeader();

  return config;
});

function maskAccessToken(token) {
  const value = String(token || "");

  if (!value) {
    return null;
  }

  if (value.length <= 10) {
    return `${value.slice(0, 2)}...${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function maskId(value) {
  const text = String(value || "");

  if (!text) {
    return null;
  }

  if (text.length <= 6) {
    return `***${text.slice(-2)}`;
  }

  return `***${text.slice(-6)}`;
}

function getConfiguredTokenVariables() {
  return TEMPLATE_TOKEN_ENV_CANDIDATES.filter((name) => Boolean(String(process.env[name] || "").trim()));
}

function getWhatsAppToken() {
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();

  return token || null;
}

function getTemplateManagementToken() {
  for (const variable of TEMPLATE_TOKEN_ENV_CANDIDATES) {
    const token = String(process.env[variable] || "").trim();

    if (token) {
      return {
        variable,
        value: token
      };
    }
  }

  return null;
}

function getWhatsAppAuthorizationHeader() {
  const token = getWhatsAppToken();

  if (!token) {
    throw new ApiError(500, "WHATSAPP_TOKEN is not configured", undefined, { omitErrors: true });
  }

  return `Bearer ${token}`;
}

function absolutizeGraphApiUrl(rawUrl) {
  const value = String(rawUrl || "");

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `${GRAPH_API_BASE_URL}/${value.replace(/^\/+/, "")}`;
}

function sanitizeGraphApiUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return rawUrl;
  }

  try {
    const parsed = new URL(absolutizeGraphApiUrl(rawUrl));

    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }

    return parsed.toString();
  } catch (error) {
    return rawUrl;
  }
}

function sanitizeMetaResponse(value, depth = 0) {
  if (depth > 8) {
    return "[MaxDepth]";
  }

  if (typeof value === "string") {
    return value.includes("access_token=") ? sanitizeGraphApiUrl(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetaResponse(item, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};

  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = /^(access_token|authorization|token)$/i.test(key)
      ? "[REDACTED]"
      : sanitizeMetaResponse(item, depth + 1);
  }

  return sanitized;
}

function resolveGraphApiEndpoint(requestUrl, params) {
  const targetUrl = requestUrl || `/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;

  try {
    const parsed = new URL(absolutizeGraphApiUrl(targetUrl));

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          parsed.searchParams.set(key, String(value));
        }
      }
    }

    return sanitizeGraphApiUrl(parsed.toString());
  } catch (error) {
    return sanitizeGraphApiUrl(targetUrl);
  }
}

function getTemplateManagementTokenInfo(requestUrl, params) {
  const configuredTokenVariables = getConfiguredTokenVariables();
  const graphApiEndpoint = resolveGraphApiEndpoint(requestUrl, params);
  const token = getTemplateManagementToken();
  const context = {
    tokenSource: "env",
    tokenVariable: token ? token.variable : null,
    configuredTokenVariables,
    wabaId: maskId(env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    graphApiEndpoint,
    graphApiVersion: env.META_API_VERSION
  };

  if (!token) {
    logger.error(context, "WhatsApp template management token is not configured");
    throw new ApiError(
      500,
      "WhatsApp template sync token is not configured. Configure WHATSAPP_ACCESS_TOKEN or SYSTEM_USER_TOKEN with whatsapp_business_management permissions.",
      undefined,
      { omitErrors: true }
    );
  }

  if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    logger.error(context, "WHATSAPP_BUSINESS_ACCOUNT_ID is not configured");
    throw new ApiError(500, "WHATSAPP_BUSINESS_ACCOUNT_ID is required for WhatsApp template sync", undefined, { omitErrors: true });
  }

  return {
    ...context,
    tokenPreview: maskAccessToken(token.value),
    value: token.value
  };
}

function publicTemplateRequestContext(tokenInfo) {
  return {
    tokenSource: tokenInfo.tokenSource,
    tokenVariable: tokenInfo.tokenVariable,
    tokenPreview: tokenInfo.tokenPreview,
    configuredTokenVariables: tokenInfo.configuredTokenVariables,
    wabaId: tokenInfo.wabaId,
    graphApiEndpoint: tokenInfo.graphApiEndpoint,
    graphApiVersion: tokenInfo.graphApiVersion
  };
}

function getWhatsAppError(error) {
  return (
    error.response &&
    error.response.data &&
    error.response.data.error &&
    error.response.data.error.message
  ) || (error && error.message) || "WhatsApp API request failed";
}

function maskPhone(phone) {
  const value = String(phone || "");

  if (value.length <= 4) {
    return "****";
  }

  return `${"*".repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
}

function getMetaErrorPayload(error) {
  return error &&
    error.response &&
    error.response.data &&
    error.response.data.error
    ? error.response.data.error
    : error && error.details && error.details.error ? error.details.error : null;
}

function getMetaTraceId(errorOrResponse) {
  const headers = errorOrResponse && errorOrResponse.headers
    ? errorOrResponse.headers
    : errorOrResponse && errorOrResponse.response ? errorOrResponse.response.headers : null;

  if (!headers) {
    return null;
  }

  return headers["x-fb-trace-id"] || headers["x-fb-request-id"] || headers["x-business-use-case-usage"] || null;
}

function isMetaAuthenticationError(error) {
  const metaError = getMetaErrorPayload(error);
  const type = String(metaError && metaError.type ? metaError.type : "").toLowerCase();
  const code = Number(metaError && metaError.code);
  const message = String(
    metaError && metaError.message ? metaError.message : error && error.message ? error.message : ""
  ).toLowerCase();

  return (
    type === "oauthexception" ||
    code === 190 ||
    message.includes("invalid access token") ||
    message.includes("invalid oauth access token") ||
    (message.includes("access token") && (message.includes("expired") || message.includes("invalid")))
  );
}

function isMetaPermissionError(error) {
  const metaError = getMetaErrorPayload(error);
  const code = Number(metaError && metaError.code);
  const type = String(metaError && metaError.type ? metaError.type : "").toLowerCase();
  const message = String(
    metaError && metaError.message ? metaError.message : error && error.message ? error.message : ""
  ).toLowerCase();

  return (
    code === 10 ||
    code === 200 ||
    code === 275 ||
    type.includes("permission") ||
    message.includes("permission") ||
    message.includes("permissions") ||
    message.includes("not have access") ||
    message.includes("does not have access")
  );
}

function isInvalidWabaError(error) {
  const metaError = getMetaErrorPayload(error);
  const code = Number(metaError && metaError.code);
  const status = Number(error && error.response && error.response.status);
  const message = String(
    metaError && metaError.message ? metaError.message : error && error.message ? error.message : ""
  ).toLowerCase();

  return (
    status === 400 ||
    code === 100 ||
    message.includes("unsupported get request") ||
    message.includes("object with id") ||
    message.includes("does not exist") ||
    message.includes("cannot be loaded")
  );
}

function isTransientMetaTemplateError(error) {
  const status = Number(error && error.response && error.response.status);
  const code = String(error && error.code ? error.code : "");
  const metaError = getMetaErrorPayload(error);
  const metaCode = Number(metaError && metaError.code);

  if ([408, 429].includes(status) || status >= 500) {
    return true;
  }

  if (["ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) {
    return true;
  }

  return [1, 2, 4, 17, 613].includes(metaCode);
}

function getMetaErrorDetails(error) {
  const metaError = getMetaErrorPayload(error);
  const response = error && error.response ? error.response : null;

  return {
    code: metaError && metaError.code ? metaError.code : null,
    subcode: metaError && metaError.error_subcode ? metaError.error_subcode : null,
    message: metaError && metaError.message ? metaError.message : getWhatsAppError(error),
    type: metaError && metaError.type ? metaError.type : null,
    traceId: getMetaTraceId(response || error),
    status: response && response.status ? response.status : error && error.status ? error.status : null
  };
}

function classifyMetaTemplateError(error) {
  if (isMetaAuthenticationError(error)) {
    return "authentication";
  }

  if (isMetaPermissionError(error)) {
    return "permission";
  }

  if (isInvalidWabaError(error)) {
    return "configuration";
  }

  if (isTransientMetaTemplateError(error)) {
    return "transient";
  }

  return "permanent";
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(value) {
  if (!value) {
    return 0;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 0;
  }

  return Math.max(date.getTime() - Date.now(), 0);
}

function validateWhatsAppRuntimeConfig() {
  const hasPhoneNumberId = Boolean(env.WHATSAPP_PHONE_NUMBER_ID);
  const hasBusinessAccountId = Boolean(env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const hasTemplateToken = Boolean(getTemplateManagementToken());
  const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || "");
  const businessAccountId = String(env.WHATSAPP_BUSINESS_ACCOUNT_ID || "");
  const productionErrors = [];

  if (!hasPhoneNumberId) {
    logger.error("WHATSAPP_PHONE_NUMBER_ID is required for sending WhatsApp messages.");
    productionErrors.push("WHATSAPP_PHONE_NUMBER_ID is required");
  }

  if (!getWhatsAppToken()) {
    logger.error("WHATSAPP_TOKEN is required for sending WhatsApp messages and media operations.");
    productionErrors.push("WHATSAPP_TOKEN is required");
  }

  if (!hasBusinessAccountId) {
    logger.error("WHATSAPP_BUSINESS_ACCOUNT_ID is required for WhatsApp template synchronization.");
    productionErrors.push("WHATSAPP_BUSINESS_ACCOUNT_ID is required");
  }

  if (!hasTemplateToken) {
    logger.error("WHATSAPP_ACCESS_TOKEN or SYSTEM_USER_TOKEN is required for WhatsApp template synchronization.");
    productionErrors.push("WHATSAPP_ACCESS_TOKEN or SYSTEM_USER_TOKEN is required for template synchronization");
  }

  if (hasBusinessAccountId && phoneNumberId && phoneNumberId === businessAccountId) {
    logger.warn("WHATSAPP_PHONE_NUMBER_ID may be incorrect. It must be the Phone Number ID from WhatsApp API Setup.");
  }

  if (phoneNumberId && !/^\d+$/.test(phoneNumberId)) {
    logger.warn("WHATSAPP_PHONE_NUMBER_ID may be incorrect. It must be the Phone Number ID from WhatsApp API Setup.");
  }

  if (env.DEBUG) {
    logger.info({
      graphApiVersion: env.META_API_VERSION,
      hasWhatsAppPhoneNumberId: hasPhoneNumberId,
      hasWhatsAppBusinessAccountId: hasBusinessAccountId,
      hasTemplateManagementToken: hasTemplateToken
    }, "WhatsApp Meta configuration loaded");
  }

  if (env.NODE_ENV === "production" && productionErrors.length > 0) {
    throw new Error(`Invalid WhatsApp production configuration: ${productionErrors.join("; ")}`);
  }
}

async function sendCloudMessage(payload) {
  logger.info({
    type: payload.type,
    to: maskPhone(payload.to),
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID
  }, "Sending WhatsApp Cloud API message");

  try {
    const response = await client.post(`/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, payload);

    logger.info({
      type: payload.type,
      to: maskPhone(payload.to),
      whatsappMessageId: extractMessageId(response.data)
    }, "WhatsApp Cloud API message accepted");

    return response.data;
  } catch (error) {
    const message = getWhatsAppError(error);
    const wrapped = new Error(message);
    wrapped.status = error.response && error.response.status;
    wrapped.details = error.response && error.response.data;
    wrapped.retryAfterMs = error.response && error.response.headers
      ? parseRetryAfterMs(error.response.headers["retry-after"] || error.response.headers["Retry-After"])
      : 0;

    logger.error({
      err: wrapped,
      status: wrapped.status,
      retryAfterMs: wrapped.retryAfterMs,
      type: payload.type,
      to: maskPhone(payload.to)
    }, "WhatsApp Cloud API message failed");

    throw wrapped;
  }
}

async function sendTextMessage(to, text) {
  return sendCloudMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: text
    }
  });
}

async function sendTemplateMessage(to, templateName, languageCode, components = []) {
  return sendCloudMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode
      },
      components
    }
  });
}

function buildMessageTemplatesRequest({ after } = {}) {
  const params = {
    fields: TEMPLATE_FIELDS.join(","),
    limit: TEMPLATE_PAGE_LIMIT
  };

  if (after) {
    params.after = after;
  }

  return {
    url: `/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`,
    params
  };
}

function buildTemplateApiError(error, requestContext) {
  const statusCode = error.response && error.response.status ? error.response.status : 502;
  const details = getMetaErrorDetails(error);
  const category = classifyMetaTemplateError(error);
  let message = getWhatsAppError(error);

  if (category === "authentication") {
    message = "تعذر مزامنة قوالب واتساب: رمز الوصول غير صالح أو منتهي الصلاحية.";
  } else if (category === "permission") {
    message = "تعذر مزامنة قوالب واتساب: قد يحتاج الرمز إلى صلاحيات whatsapp_business_management و business_management.";
  } else if (category === "configuration") {
    message = "تعذر مزامنة قوالب واتساب: تحقق من WHATSAPP_BUSINESS_ACCOUNT_ID وإصدار Graph API.";
  }

  return new ApiError(statusCode, message, {
    ...requestContext,
    category,
    metaErrorCode: details.code,
    metaErrorSubcode: details.subcode,
    metaTraceId: details.traceId,
    metaErrorType: details.type
  });
}

async function fetchMessageTemplatesPage(url, params, options = {}) {
  const requestUrl = url || buildMessageTemplatesRequest().url;
  const tokenInfo = getTemplateManagementTokenInfo(requestUrl, params);
  const requestContext = publicTemplateRequestContext(tokenInfo);
  const httpClient = options.httpClient || client;

  logger.info(requestContext, "Fetching WhatsApp templates from Meta");

  try {
    const response = await httpClient.get(requestUrl, {
      headers: {
        Authorization: `Bearer ${tokenInfo.value}`
      },
      timeout: options.timeout || 15000,
      ...(params ? { params } : {})
    });
    const metaResponse = sanitizeMetaResponse(response.data);
    const details = getMetaErrorDetails({ response });

    logger.debugStep("WhatsApp templates page returned", {
      requestUrl,
      count: Array.isArray(response.data && response.data.data) ? response.data.data.length : 0,
      hasNextPage: Boolean(response.data && response.data.paging && response.data.paging.next)
    });
    logger.info({
      ...requestContext,
      status: response.status,
      metaTraceId: details.traceId,
      fetched: Array.isArray(response.data && response.data.data) ? response.data.data.length : 0,
      hasNextPage: Boolean(response.data && response.data.paging && response.data.paging.next)
    }, "Meta WhatsApp templates response returned");

    return {
      body: response.data,
      diagnostics: {
        ...requestContext,
        status: response.status,
        metaTraceId: details.traceId,
        metaResponse
      }
    };
  } catch (error) {
    const metaResponse = sanitizeMetaResponse(error.response && error.response.data);
    const metaDetails = getMetaErrorDetails(error);
    const errorContext = {
      ...requestContext,
      status: error.response && error.response.status ? error.response.status : null,
      metaErrorCode: metaDetails.code,
      metaErrorSubcode: metaDetails.subcode,
      metaTraceId: metaDetails.traceId,
      metaResponse
    };
    const wrapped = buildTemplateApiError(error, errorContext);

    logger.error({
      err: wrapped,
      status: wrapped.statusCode,
      ...requestContext,
      metaErrorCode: errorContext.metaErrorCode,
      metaErrorSubcode: errorContext.metaErrorSubcode,
      metaTraceId: errorContext.metaTraceId
    }, "Failed to fetch WhatsApp templates");

    throw wrapped;
  }
}

async function fetchMessageTemplatesPageWithRetry(url, params, options = {}) {
  let attempt = 0;

  while (attempt < TEMPLATE_MAX_ATTEMPTS) {
    attempt += 1;

    try {
      return await fetchMessageTemplatesPage(url, params, options);
    } catch (error) {
      const category = error.details && error.details.category
        ? error.details.category
        : classifyMetaTemplateError(error);
      const shouldRetry = category === "transient" && attempt < TEMPLATE_MAX_ATTEMPTS;

      if (!shouldRetry) {
        throw error;
      }

      logger.warn({
        err: error,
        attempt,
        maxAttempts: TEMPLATE_MAX_ATTEMPTS,
        category,
        metaErrorCode: error.details && error.details.metaErrorCode,
        metaTraceId: error.details && error.details.metaTraceId
      }, "Retrying transient WhatsApp template sync page failure");

      await sleep((options.retryDelayMs ?? TEMPLATE_RETRY_DELAY_MS) * attempt);
    }
  }

  throw new ApiError(502, "تعذرت مزامنة قوالب واتساب بعد عدة محاولات");
}

async function fetchAllMessageTemplates(options = {}) {
  const templates = [];
  const responses = [];
  let firstRequestContext = null;
  let nextUrl = null;
  let after = null;
  let page = 0;
  const seenCursors = new Set();

  do {
    page += 1;
    const request = nextUrl ? { url: nextUrl, params: undefined } : buildMessageTemplatesRequest({ after });
    const pageResult = await fetchMessageTemplatesPageWithRetry(request.url, request.params, options);
    const response = pageResult.body;

    if (!firstRequestContext) {
      firstRequestContext = {
        tokenSource: pageResult.diagnostics.tokenSource,
        tokenVariable: pageResult.diagnostics.tokenVariable,
        tokenPreview: pageResult.diagnostics.tokenPreview,
        configuredTokenVariables: pageResult.diagnostics.configuredTokenVariables,
        wabaId: pageResult.diagnostics.wabaId,
        graphApiEndpoint: pageResult.diagnostics.graphApiEndpoint,
        graphApiVersion: pageResult.diagnostics.graphApiVersion
      };
    }

    responses.push({
      page,
      graphApiEndpoint: pageResult.diagnostics.graphApiEndpoint,
      status: pageResult.diagnostics.status,
      metaTraceId: pageResult.diagnostics.metaTraceId,
      responseBody: pageResult.diagnostics.metaResponse
    });

    if (Array.isArray(response.data)) {
      templates.push(...response.data);
    }

    nextUrl = response.paging && response.paging.next ? response.paging.next : null;
    after = null;

    if (!nextUrl && response.paging && response.paging.cursors && response.paging.cursors.after) {
      const cursor = response.paging.cursors.after;

      if (!seenCursors.has(cursor) && Array.isArray(response.data) && response.data.length > 0) {
        seenCursors.add(cursor);
        after = cursor;
      }
    }

    logger.debugStep("WhatsApp templates pagination", {
      page,
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      totalFetched: templates.length,
      hasNextPage: Boolean(nextUrl || after)
    });
  } while (nextUrl || after);

  logger.info({
    ...(firstRequestContext || {}),
    fetched: templates.length,
    pages: page
  }, "Fetched WhatsApp templates from Meta");

  return {
    templates,
    meta: {
      ...firstRequestContext,
      fetched: templates.length,
      pages: page,
      responses
    }
  };
}

async function uploadMedia(file) {
  const form = new FormData();

  form.append("messaging_product", "whatsapp");
  form.append("file", fs.createReadStream(file.localPath), {
    filename: file.fileName || "media",
    contentType: file.mimeType
  });

  logger.info({
    fileName: file.fileName,
    mimeType: file.mimeType,
    fileSize: file.fileSize || null,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID
  }, "Uploading WhatsApp media");

  try {
    const response = await client.post(`/${env.WHATSAPP_PHONE_NUMBER_ID}/media`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    logger.info({
      mediaId: response.data && response.data.id,
      mimeType: file.mimeType
    }, "WhatsApp media uploaded");

    return response.data;
  } catch (error) {
    const message = getWhatsAppError(error);
    const wrapped = new Error(message);
    wrapped.status = error.response && error.response.status;
    wrapped.details = error.response && error.response.data;

    logger.error({
      err: wrapped,
      status: wrapped.status,
      mimeType: file.mimeType,
      fileSize: file.fileSize || null
    }, "WhatsApp media upload failed");

    throw wrapped;
  }
}

async function getMediaMetadata(mediaId) {
  try {
    const response = await client.get(`/${mediaId}`);

    logger.debugStep("WhatsApp media metadata returned", {
      mediaId,
      metadata: response.data
    });

    return response.data;
  } catch (error) {
    const message = getWhatsAppError(error);
    const wrapped = new Error(message);
    wrapped.status = error.response && error.response.status;
    wrapped.details = error.response && error.response.data;

    logger.error({
      err: wrapped,
      status: wrapped.status,
      mediaId
    }, "Failed to fetch WhatsApp media metadata");

    throw wrapped;
  }
}

async function downloadMedia(mediaId) {
  const metadata = await getMediaMetadata(mediaId);

  if (!metadata.url) {
    throw new Error("WhatsApp media metadata did not include a download URL");
  }

  try {
    const response = await axios.get(metadata.url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`
      },
      maxContentLength: Infinity
    });

    logger.info({
      mediaId,
      mimeType: metadata.mime_type || response.headers["content-type"] || null,
      fileSize: Number(metadata.file_size) || Number(response.headers["content-length"]) || null
    }, "Downloaded WhatsApp media");

    return {
      metadata,
      buffer: Buffer.from(response.data),
      mimeType: metadata.mime_type || response.headers["content-type"] || null,
      fileSize: Number(metadata.file_size) || Number(response.headers["content-length"]) || null
    };
  } catch (error) {
    const wrapped = new Error(getWhatsAppError(error));
    wrapped.status = error.response && error.response.status;
    wrapped.details = error.response && error.response.data;

    logger.error({
      err: wrapped,
      status: wrapped.status,
      mediaId
    }, "Failed to download WhatsApp media");

    throw wrapped;
  }
}

async function sendImageMessage(to, mediaId, caption) {
  return sendCloudMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: {
      id: mediaId,
      ...(caption ? { caption } : {})
    }
  });
}

async function sendVideoMessage(to, mediaId, caption) {
  return sendCloudMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "video",
    video: {
      id: mediaId,
      ...(caption ? { caption } : {})
    }
  });
}

async function sendAudioMessage(to, mediaId) {
  return sendCloudMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "audio",
    audio: {
      id: mediaId
    }
  });
}

async function sendDocumentMessage(to, mediaId, filename, caption) {
  return sendCloudMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document: {
      id: mediaId,
      ...(filename ? { filename } : {}),
      ...(caption ? { caption } : {})
    }
  });
}

function extractMessageId(response) {
  return response && response.messages && response.messages[0] && response.messages[0].id;
}

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  fetchAllMessageTemplates,
  buildMessageTemplatesRequest,
  classifyMetaTemplateError,
  isTransientMetaTemplateError,
  uploadMedia,
  getMediaMetadata,
  downloadMedia,
  sendImageMessage,
  sendVideoMessage,
  sendAudioMessage,
  sendDocumentMessage,
  validateWhatsAppRuntimeConfig,
  getMetaErrorDetails,
  extractMessageId
};
