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

type MeResponse = { user: User; role: User["role"]; permissions: string[] };
let pendingMeRequest: Promise<MeResponse> | null = null;

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
  if (!pendingMeRequest) {
    pendingMeRequest = api.get("/api/auth/me")
      .then((response) => unwrap<MeResponse>(response))
      .finally(() => {
        pendingMeRequest = null;
      });
  }

  return pendingMeRequest;
}
