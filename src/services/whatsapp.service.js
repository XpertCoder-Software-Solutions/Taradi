const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const env = require("../config/env");
const logger = require("../config/logger");

const client = axios.create({
  baseURL: `https://graph.facebook.com/${env.META_API_VERSION}`,
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
    "Content-Type": "application/json"
  }
});

function getWhatsAppError(error) {
  return (
    error.response &&
    error.response.data &&
    error.response.data.error &&
    error.response.data.error.message
  ) || error.message;
}

function maskPhone(phone) {
  const value = String(phone || "");

  if (value.length <= 4) {
    return "****";
  }

  return `${"*".repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
}

function getMetaErrorDetails(error) {
  const metaError = error &&
    error.response &&
    error.response.data &&
    error.response.data.error
    ? error.response.data.error
    : error && error.details && error.details.error ? error.details.error : null;

  return {
    code: metaError && metaError.code ? metaError.code : null,
    subcode: metaError && metaError.error_subcode ? metaError.error_subcode : null,
    message: metaError && metaError.message ? metaError.message : getWhatsAppError(error)
  };
}

function validateWhatsAppRuntimeConfig() {
  const hasPhoneNumberId = Boolean(env.WHATSAPP_PHONE_NUMBER_ID);
  const hasBusinessAccountId = Boolean(env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || "");
  const businessAccountId = String(env.WHATSAPP_BUSINESS_ACCOUNT_ID || "");

  if (!hasPhoneNumberId) {
    logger.error("WHATSAPP_PHONE_NUMBER_ID is required for sending WhatsApp messages.");
  }

  if (hasBusinessAccountId && phoneNumberId && phoneNumberId === businessAccountId) {
    logger.warn("WHATSAPP_PHONE_NUMBER_ID may be incorrect. It must be the Phone Number ID from WhatsApp API Setup.");
  }

  if (phoneNumberId && !/^\d+$/.test(phoneNumberId)) {
    logger.warn("WHATSAPP_PHONE_NUMBER_ID may be incorrect. It must be the Phone Number ID from WhatsApp API Setup.");
  }

  if (env.DEBUG) {
    logger.info({
      metaApiVersion: env.META_API_VERSION,
      hasWhatsAppPhoneNumberId: hasPhoneNumberId,
      hasWhatsAppBusinessAccountId: hasBusinessAccountId
    }, "WhatsApp Meta configuration loaded");
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

    logger.error({
      err: wrapped,
      status: wrapped.status,
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
      fileSize: metadata.file_size || Number(response.headers["content-length"]) || null
    }, "Downloaded WhatsApp media");

    return {
      metadata,
      buffer: Buffer.from(response.data),
      mimeType: metadata.mime_type || response.headers["content-type"] || null,
      fileSize: metadata.file_size || Number(response.headers["content-length"]) || null
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
  uploadMedia,
  getMediaMetadata,
  downloadMedia,
  sendImageMessage,
  sendAudioMessage,
  sendDocumentMessage,
  validateWhatsAppRuntimeConfig,
  getMetaErrorDetails,
  extractMessageId
};
