import { formatArabicDateTime, formatArabicFileSize } from "./i18n";

export function formatDateTime(value?: string | null) {
  return formatArabicDateTime(value);
}

export function formatPhone(value?: string | null) {
  return value || "غير متاح";
}

export function formatFileSize(value?: number | null) {
  return formatArabicFileSize(value);
}
