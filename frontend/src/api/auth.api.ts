import { api, unwrap } from "../lib/api";
import { debugLog } from "../lib/debug";
import type { User } from "../types/api";

export interface LoginPayload {
  email?: string;
  employeeCode?: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  role: User["role"];
  permissions: string[];
}

export async function login(payload: LoginPayload) {
  debugLog("Before login API request", {
    endpoint: "/api/auth/login",
    email: payload.email,
    employeeCode: payload.employeeCode
  });

  try {
    const result = unwrap<LoginResponse>(await api.post("/api/auth/login", payload));

    debugLog("Login API response received", {
      role: result.user.role,
      userId: result.user.id,
      hasToken: Boolean(result.token)
    });

    return result;
  } catch (error) {
    debugLog("Login API request failed", error);
    throw error;
  }
}

export async function me() {
  return unwrap<{ user: User; role: User["role"]; permissions: string[] }>(await api.get("/api/auth/me"));
}
