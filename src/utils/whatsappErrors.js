const WHATSAPP_24H_TEXT_REJECTION_MESSAGE = "فشل الإرسال: لا يمكن إرسال رسالة نصية مباشرة لأن العميل لم يبدأ محادثة خلال آخر 24 ساعة.";

function getMetaError(error) {
  if (!error || typeof error !== "object") {
    return null;
  }

  if (error.details && error.details.error) {
    return error.details.error;
  }

  if (error.response && error.response.data && error.response.data.error) {
    return error.response.data.error;
  }

  if (error.error && typeof error.error === "object") {
    return error.error;
  }

  return null;
}

function getErrorData(error) {
  if (!error || typeof error !== "object") {
    return null;
  }

  return error.error_data || error.errorData || null;
}

function isWhatsAppTextWindowError(error) {
  const metaError = getMetaError(error);
  const errorData = getErrorData(error) || getErrorData(metaError);
  const code = String(
    (metaError && metaError.code) ||
    (error && typeof error === "object" && error.code) ||
    ""
  );
  const subcode = String(
    (metaError && metaError.error_subcode) ||
    (error && typeof error === "object" && error.error_subcode) ||
    ""
  );
  const text = [
    error && typeof error === "object" ? error.message : error,
    error && typeof error === "object" ? error.title : null,
    metaError && metaError.message,
    metaError && metaError.title,
    errorData && errorData.details
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return code === "131047" ||
    subcode === "131047" ||
    text.includes("re-engagement") ||
    text.includes("customer service window") ||
    (text.includes("outside") && text.includes("24") && text.includes("window")) ||
    (text.includes("24") && text.includes("hour") && text.includes("conversation"));
}

function friendlyWhatsAppFailureMessage(error, fallbackMessage) {
  if (!error && !fallbackMessage) {
    return null;
  }

  if (isWhatsAppTextWindowError(error)) {
    return WHATSAPP_24H_TEXT_REJECTION_MESSAGE;
  }

  if (fallbackMessage !== undefined) {
    return fallbackMessage;
  }

  return "تعذر إرسال رسالة واتساب";
}

module.exports = {
  WHATSAPP_24H_TEXT_REJECTION_MESSAGE,
  friendlyWhatsAppFailureMessage,
  isWhatsAppTextWindowError
};
