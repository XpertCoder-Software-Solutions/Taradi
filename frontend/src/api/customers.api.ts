import { api, unwrap } from "../lib/api";
import type { CollectionStatus, Customer, CustomerDebt, CustomerImportSummary, InvoiceStatus, Paginated } from "../types/api";

export interface CustomerFilters {
  page?: number;
  limit?: number;
  search?: string;
  assignment?: "unassigned";
  assignedToId?: string;
  assignedEmployeeId?: string;
  assignmentStatus?: "assigned" | "unassigned";
  supervisorId?: string;
  projectName?: string;
  invoiceStatus?: InvoiceStatus;
  collectionStatus?: CollectionStatus;
  contactBlocked?: boolean;
  paidOnly?: boolean;
  debtYear?: number | string;
  sortBy?: "fullName" | "debtAmount" | "createdAt";
  sortOrder?: "asc" | "desc";
}

export interface CreateCustomerPayload {
  fullName: string;
  nationalId: string;
  accountNumber: string;
  projectName: string;
  projectNameRaw?: string | null;
  debtAmount: string;
  serviceNumber: string;
  serviceActivationDate?: string | null;
  serviceTerminationDate?: string | null;
  invoiceStatus: InvoiceStatus;
  collectionStatus?: CollectionStatus;
  paidAt?: string | null;
  paidAmount?: string | null;
  paymentReference?: string | null;
  paymentNotes?: string | null;
  debtYear: number;
  primaryPhone: string;
  secondaryPhones?: string[];
  notes?: string | null;
  assignedEmployeeId?: string | null;
}

export type UpdateCustomerPayload = Partial<CreateCustomerPayload>;

export interface CustomerReassignmentResponse {
  customer: Customer;
  customerId?: string;
  previousAssigneeId?: string | null;
  newAssigneeId?: string | null;
  archivedConversationId?: string | null;
  activeConversationId?: string | null;
  reassignedAt?: string;
  sameAssignment?: boolean;
}

export async function listCustomers(filters: CustomerFilters = {}, signal?: AbortSignal) {
  return unwrap<Paginated<Customer>>(await api.get("/api/customers", { params: filters, signal }));
}

export async function createCustomer(payload: CreateCustomerPayload) {
  return unwrap<{ customer: Customer }>(await api.post("/api/customers", payload));
}

export async function updateCustomer(id: string, payload: UpdateCustomerPayload) {
  return unwrap<CustomerReassignmentResponse>(await api.patch(`/api/customers/${id}`, payload));
}

export async function updateCustomerCollectionStatus(id: string, payload: {
  collectionStatus: CollectionStatus;
  paidAt?: string | null;
  paidAmount?: string | null;
  paymentReference?: string | null;
  paymentNotes?: string | null;
  resetPayment?: boolean;
}) {
  return unwrap<{ customer: Customer }>(await api.patch(`/api/customers/${id}/collection-status`, payload));
}

export async function assignCustomer(id: string, employeeId: string | null, reason?: string | null) {
  return unwrap<CustomerReassignmentResponse>(
    await api.patch(`/api/customers/${id}/assign`, { employeeId, reason })
  );
}

export async function importCustomersCsv(file: File) {
  const form = new FormData();
  form.append("file", file);

  return unwrap<CustomerImportSummary>(
    await api.post("/api/customers/import-csv", form)
  );
}

export async function importCustomersExcel(file: File) {
  const form = new FormData();
  form.append("file", file);

  return unwrap<CustomerImportSummary>(
    await api.post("/api/customers/import-excel", form)
  );
}

export async function deleteCustomer(id: string) {
  return unwrap<{ deleted: boolean }>(await api.delete(`/api/customers/${id}`));
}

export type DebtPayload = Omit<CustomerDebt, "id" | "customerId" | "createdAt" | "updatedAt" | "isActive">;
export async function listCustomerDebts(customerId: string) { return unwrap<{ debts: CustomerDebt[] }>(await api.get(`/api/customers/${customerId}/debts`)); }
export async function createCustomerDebt(customerId: string, payload: Partial<DebtPayload> & Pick<DebtPayload, "accountNumber" | "debtYear" | "debtAmount">) { return unwrap<{ debt: CustomerDebt }>(await api.post(`/api/customers/${customerId}/debts`, payload)); }
export async function updateCustomerDebt(customerId: string, debtId: string, payload: Partial<DebtPayload>) { return unwrap<{ debt: CustomerDebt }>(await api.patch(`/api/customers/${customerId}/debts/${debtId}`, payload)); }
export async function archiveCustomerDebt(customerId: string, debtId: string) { return unwrap<{ debt: CustomerDebt }>(await api.post(`/api/customers/${customerId}/debts/${debtId}/archive`)); }
