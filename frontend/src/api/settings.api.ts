import { api, unwrap } from "../lib/api";
import type { PermissionMatrix } from "../types/api";

export async function getPermissions() {
  return unwrap<PermissionMatrix>(await api.get("/api/settings/permissions"));
}

export async function updatePermissions(payload: {
  role: "SUPERVISOR" | "EMPLOYEE";
  permissions: Record<string, boolean>;
}) {
  return unwrap<PermissionMatrix>(await api.patch("/api/settings/permissions", payload));
}
