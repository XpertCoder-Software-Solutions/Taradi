import { api, unwrap } from "../lib/api";
import type { CollectionStatus, Customer, CustomerImportSummary, InvoiceStatus, Paginated } from "../types/api";

export interface CustomerFilters {
  page?: number;
  limit?: number;
  search?: string;
  assignment?: "unassigned";
  assignedToId?: string;
  assignedEmployeeId?: string;
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

export async function listCustomers(filters: CustomerFilters = {}) {
  return unwrap<Paginated<Customer>>(await api.get("/api/customers", { params: filters }));
}

export async function createCustomer(payload: CreateCustomerPayload) {
  return unwrap<{ customer: Customer }>(await api.post("/api/customers", payload));
}

export async function updateCustomer(id: string, payload: UpdateCustomerPayload) {
  return unwrap<{ customer: Customer }>(await api.patch(`/api/customers/${id}`, payload));
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

export async function assignCustomer(id: string, employeeId: string | null) {
  return unwrap<{ customer: Customer }>(
    await api.patch(`/api/customers/${id}/assign`, { employeeId })
  );
}

export async function importCustomersCsv(file: File) {
  const form = new FormData();
  form.append("file", file);

  return unwrap<CustomerImportSummary>(
    await api.post("/api/customers/import-csv", form)
  );
}

export async function deleteCustomer(id: string) {
  return unwrap<{ deleted: boolean }>(await api.delete(`/api/customers/${id}`));
}
