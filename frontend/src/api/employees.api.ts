import { api, unwrap } from "../lib/api";
import { debugLog } from "../lib/debug";
import type { EmployeeImportSummary, EmployeePresenceResponse, Paginated, Role, User } from "../types/api";

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

type EmployeeListPayload = Partial<Paginated<User>> & {
  data?: unknown;
  employees?: User[];
  results?: User[];
  total?: number;
  page?: number;
  limit?: number;
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeEmployeeList(payload: unknown, filters: EmployeeFilters): Paginated<User> {
  const source = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  const record = isRecord(source) ? source as EmployeeListPayload : null;
  const items = Array.isArray(source)
    ? source as User[]
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.employees)
        ? record.employees
        : Array.isArray(record?.results)
          ? record.results
          : [];
  const meta = record?.meta || record?.pagination || {};
  const page = Number(meta.page ?? record?.page ?? filters.page ?? 1);
  const fallbackLimit = items.length || 10;
  const limit = Number(meta.limit ?? record?.limit ?? filters.limit ?? fallbackLimit);
  const total = Number(meta.total ?? record?.total ?? items.length);

  return {
    items,
    meta: {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
      total: Number.isFinite(total) && total >= 0 ? total : items.length
    }
  };
}

export async function listEmployees(filters: EmployeeFilters = {}) {
  const result = normalizeEmployeeList(
    unwrap<unknown>(await api.get("/api/employees", { params: filters })),
    filters
  );

  debugLog("Employees API response received", {
    roleFilter: filters.role || "ALL",
    activeFilter: filters.isActive,
    supervisorId: filters.supervisorId,
    count: result.items.length,
    total: result.meta.total
  });

  return result;
}

export async function getEmployeePresence() {
  return unwrap<EmployeePresenceResponse>(await api.get("/api/employees/presence"));
}

export async function createEmployee(payload: CreateEmployeePayload) {
  return unwrap<{ employee: User }>(await api.post("/api/employees", payload));
}

export async function importEmployeesExcel(file: File) {
  const form = new FormData();

  form.append("file", file);

  return unwrap<EmployeeImportSummary>(
    await api.post("/api/employees/import", form)
  );
}

export async function downloadEmployeeImportTemplate() {
  const response = await api.get("/api/employees/import/template", { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");

  link.href = url;
  link.download = "employees-import-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export interface UserImportResult {
  totalRows: number;
  imported: number;
  failed: number;
  users: Array<{ name: string; email: string; phone: string; employeeCode: string; temporaryPassword: string }>;
  errors: Array<{ row: number; reason: string }>;
}

export async function importUsersExcel(role: "EMPLOYEE" | "SUPERVISOR", file: File) {
  const form = new FormData(); form.append("file", file);
  const path = role === "SUPERVISOR" ? "supervisors" : "employees";
  return unwrap<UserImportResult>(await api.post(`/api/users/import/${path}`, form));
}

export async function downloadUserImportTemplate(role: "EMPLOYEE" | "SUPERVISOR") {
  const path = role === "SUPERVISOR" ? "supervisors" : "employees";
  const response = await api.get(`/api/users/import/${path}/template`, { responseType: "blob" });
  const url = URL.createObjectURL(response.data); const link = document.createElement("a");
  link.href = url; link.download = `${path}-import-template.xlsx`; link.click(); URL.revokeObjectURL(url);
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
