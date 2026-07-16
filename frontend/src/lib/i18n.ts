import type { ConversationPriority, ConversationStatus, MessageStatus, MessageType, Role } from "../types/api";
import { getApiErrorMessage } from "./api";

const arabicDateFormatter = new Intl.DateTimeFormat("ar-EG", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit"
});

const arabicDayFormatter = new Intl.DateTimeFormat("ar-EG", {
  day: "numeric",
  month: "short",
  year: "numeric"
});

const arabicTimeFormatter = new Intl.DateTimeFormat("ar-EG", {
  hour: "2-digit",
  minute: "2-digit"
});

export const roleLabel: Record<Role, string> = {
  ADMIN: "مدير",
  SUPERVISOR: "مشرف",
  EMPLOYEE: "موظف"
};

export const statusLabel: Record<ConversationStatus, string> = {
  OPEN: "مفتوحة",
  PENDING: "قيد المتابعة",
  CLOSED: "مغلقة"
};

export const priorityLabel: Record<ConversationPriority, string> = {
  LOW: "منخفضة",
  NORMAL: "عادية",
  HIGH: "مرتفعة",
  URGENT: "عاجلة"
};

export const messageStatusLabel: Record<MessageStatus, string> = {
  RECEIVED: "واردة",
  QUEUED: "قيد الإرسال",
  SENT: "تم الإرسال",
  DELIVERED: "تم التسليم",
  READ: "تمت القراءة",
  FAILED: "فشل الإرسال"
};

export const directTextWindowFailureMessage = "فشل الإرسال: لا يمكن إرسال رسالة نصية مباشرة لأن العميل لم يبدأ محادثة خلال آخر 24 ساعة.";

export const messageTypeLabel: Record<MessageType, string> = {
  TEXT: "رسالة نصية",
  IMAGE: "صورة",
  AUDIO: "مقطع صوتي",
  VOICE: "رسالة صوتية",
  DOCUMENT: "مستند",
  TEMPLATE: "قالب",
  SYSTEM: "النظام",
  VIDEO: "فيديو",
  STICKER: "ملصق",
  INTERACTIVE: "رسالة تفاعلية",
  UNKNOWN: "رسالة غير مدعومة"
};

export const mediaTypeLabel = {
  image: "صورة",
  audio: "صوت",
  voice: "رسالة صوتية",
  video: "فيديو",
  document: "ملف"
} as const;

export function formatArabicDateTime(value?: string | null) {
  if (!value) {
    return "غير متاح";
  }

  return arabicDateFormatter.format(new Date(value));
}

export function formatChatTime(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (startOfMessageDay === startOfToday) {
    return arabicTimeFormatter.format(date);
  }

  if (startOfMessageDay === startOfToday - oneDay) {
    return "أمس";
  }

  return arabicDayFormatter.format(date);
}

export function formatArabicFileSize(value?: number | null) {
  if (!value) {
    return "غير متاح";
  }

  if (value < 1024) {
    return `${value} بايت`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} كيلوبايت`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

export function isDirectTextWindowFailureReason(value?: string | null) {
  const message = String(value || "").trim();
  const normalized = message.toLowerCase();

  return normalized.includes("re-engagement") ||
    normalized.includes("customer service window") ||
    normalized.includes("131047") ||
    (normalized.includes("outside") && normalized.includes("24") && normalized.includes("window")) ||
    message.includes("آخر 24 ساعة") ||
    message.includes("لم يبدأ محادثة خلال");
}

export function friendlyMessageFailureReason(value?: string | null) {
  const message = String(value || "").trim();

  if (!message) {
    return "تعذر إرسال رسالة واتساب. يرجى المحاولة لاحقًا.";
  }

  if (isDirectTextWindowFailureReason(message)) {
    return directTextWindowFailureMessage;
  }

  if (/[\u0600-\u06FF]/.test(message)) {
    return message;
  }

  return "تعذر إرسال رسالة واتساب. يرجى المحاولة لاحقًا.";
}

export function translateApiError(error: unknown) {
  const message = getApiErrorMessage(error);

  if (!message || message === "Network Error") {
    return "تعذر الاتصال بالخادم";
  }

  if (message.toLowerCase().includes("unauthorized")) {
    return "انتهت الجلسة أو لا تملك صلاحية الوصول";
  }

  if (message.toLowerCase().includes("too many requests")) {
    return "تمت محاولات كثيرة، برجاء الانتظار قليلًا ثم المحاولة مرة أخرى";
  }

  if (message.includes("حالة التحصيل تمنع التواصل")) {
    return "لا يمكن إرسال رسالة لهذا العميل بسبب حالة التحصيل";
  }

  if (message.toLowerCase().includes("validation")) {
    return "يرجى مراجعة البيانات المدخلة";
  }

  return message;
}
