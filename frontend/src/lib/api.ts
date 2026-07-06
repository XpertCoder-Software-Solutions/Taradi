import axios, { AxiosError } from "axios";
import { clearSession, getStoredToken } from "./storage";
import type { ApiFailure, ApiSuccess } from "../types/api";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_BASE_URL;

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiFailure>) => {
    if (error.response?.status === 401) {
      clearSession();
      window.dispatchEvent(new Event("taradi:unauthorized"));
    }

    return Promise.reject(error);
  }
);

export function unwrap<T>(response: { data: ApiSuccess<T> }) {
  return response.data.data;
}

export function getApiErrorMessage(error: unknown) {
  if (axios.isAxiosError<ApiFailure>(error)) {
    return error.response?.data?.message || error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "حدث خطأ غير متوقع";
}

export function absoluteMediaUrl(mediaUrl?: string | null) {
  if (!mediaUrl) {
    return null;
  }

  if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
    return mediaUrl;
  }

  return `${API_BASE_URL}${mediaUrl}`;
}
