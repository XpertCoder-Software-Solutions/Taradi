import { api, unwrap } from "../lib/api";
import type { EmployeePresenceResponse, Paginated, Role, User } from "../types/api";

export interface EmployeeFilters {
  page?: number;
  limit?: number;
  search?: string;
  role?: Extract<Role, "SUPERVISOR" | "EMPLOYEE"> | "";
  isActive?: boolean | "";
  supervisorId?: string;
  sortBy?: "name" | "employeeCode" | "createdAt" | "assignedCustomersCount";
  sortOrder?: "asc" | "desc";
}

export interface CreateEmployeePayload {
  employeeName: string;
  employeeCode?: string | null;
  role: Extract<Role, "SUPERVISOR" | "EMPLOYEE">;
  supervisorId?: string | null;
  password: string;
  email?: string | null;
  isActive?: boolean;
}

export interface UpdateEmployeePayload {
  employeeName?: string;
  employeeCode?: string;
  role?: Extract<Role, "SUPERVISOR" | "EMPLOYEE">;
  supervisorId?: string | null;
  email?: string | null;
  password?: string;
  isActive?: boolean;
}

export async function listEmployees(filters: EmployeeFilters = {}) {
  return unwrap<Paginated<User>>(await api.get("/api/employees", { params: filters }));
}

export async function getEmployeePresence() {
  return unwrap<EmployeePresenceResponse>(await api.get("/api/employees/presence"));
}

export async function createEmployee(payload: CreateEmployeePayload) {
  return unwrap<{ employee: User }>(await api.post("/api/employees", payload));
}

export async function updateEmployee(id: string, payload: UpdateEmployeePayload) {
  return unwrap<{ employee: User }>(await api.patch(`/api/employees/${id}`, payload));
}

export async function deactivateEmployee(id: string) {
  return unwrap<{ employee: User; message?: string }>(await api.patch(`/api/employees/${id}/deactivate`));
}

export async function activateEmployee(id: string) {
  return unwrap<{ employee: User; message?: string }>(await api.patch(`/api/employees/${id}/activate`));
}
