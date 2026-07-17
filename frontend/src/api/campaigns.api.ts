import { api, unwrap } from "../lib/api";
import type { CustomerFilters } from "./customers.api";
import type { WhatsappTemplate, WhatsappTemplateMapping, WhatsappTemplateVariable } from "../types/api";

export interface CreateCampaignPayload {
  templateId: string;
  selectionMode: "explicit" | "all_matching";
  customerIds?: string[];
  recipients?: Array<{ customerId: string; debtId: string }>;
  debtIds?: string[];
  excludedCustomerIds?: string[];
  excludedDebtIds?: string[];
  filters?: CustomerFilters;
  idempotencyKey?: string;
}

export interface CampaignExcludedCustomer {
  customerId: string;
  fullName: string;
  reason: string;
}

export type CampaignStatus =
  | "DRAFT"
  | "PREPARING"
  | "SCHEDULED"
  | "READY"
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED"
  | "CANCELLED";

export interface CampaignProgress {
  campaignId: string;
  id: string;
  status: CampaignStatus;
  templateId?: string | null;
  templateName: string;
  languageCode: string;
  selectionMode: "explicit" | "all_matching" | string;
  recipientCount: number;
  selected: number;
  eligible: number;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  pending: number;
  processing: number;
  cancelled: number;
  progressPercentage: number;
  error?: string | null;
  pauseReason?: string | null;
  phoneNumberId?: string | null;
  rateLimitPerMinute?: number | null;
  batchSize?: number | null;
  batchDelayMs?: number | null;
  phoneAccountStatus?: "UNKNOWN" | "ACTIVE" | "RESTRICTED" | "DISABLED" | "BANNED";
  phoneQualityStatus?: "UNKNOWN" | "GREEN" | "YELLOW" | "RED" | "LOW";
  phoneDisabledReason?: string | null;
  campaignsEnabled?: boolean;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  preparedAt?: string | null;
  completedAt?: string | null;
}

export interface CampaignPreviewCustomer {
  customerId: string;
  debtId?: string;
  customerName: string;
  phone: string;
  eligible: boolean;
  warnings: string[];
  resolvedVariables: Array<{
    variableKey: string;
    token: string;
    placeholderNumber: number;
    componentType: string;
    buttonIndex?: number | null;
    fieldKey: string;
    transformer?: string | null;
    fallbackValue?: string | null;
    value: string;
  }>;
  renderedTemplate: string;
}

export interface CampaignPreviewResponse {
  template: Pick<WhatsappTemplate, "id" | "name" | "language" | "category" | "status">;
  selectionMode: "explicit" | "all_matching";
  totalSelected: number;
  eligibleRecipients: number;
  skippedCustomers: number;
  invalidPhoneNumbers: number;
  estimatedSendCount: number;
  excludedCustomers?: CampaignExcludedCustomer[];
  mapping: {
    isComplete: boolean;
    message?: string | null;
    variables: WhatsappTemplateVariable[];
    mappings: WhatsappTemplateMapping[];
    missingVariables: WhatsappTemplateVariable[];
  };
  previews: CampaignPreviewCustomer[];
}

export async function createBulkCampaign(payload: CreateCampaignPayload) {
  const headers = payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : undefined;

  return unwrap<CampaignProgress>(await api.post("/api/whatsapp/templates/bulk", payload, { headers }));
}

export async function previewBulkCampaign(payload: CreateCampaignPayload & { limit?: number }, signal?: AbortSignal) {
  return unwrap<CampaignPreviewResponse>(await api.post("/api/whatsapp/templates/bulk/preview", payload, { signal }));
}

export async function getCampaignProgress(campaignId: string) {
  return unwrap<CampaignProgress>(await api.get(`/api/whatsapp/templates/bulk/${campaignId}`));
}

export async function startCampaign(campaignId: string) {
  return unwrap<CampaignProgress>(await api.post(`/api/campaigns/${campaignId}/start`));
}
export async function pauseCampaign(campaignId: string, reason?: string) {
  return unwrap<CampaignProgress>(await api.post(`/api/campaigns/${campaignId}/pause`, { reason }));
}
export async function resumeCampaign(campaignId: string) {
  return unwrap<CampaignProgress>(await api.post(`/api/campaigns/${campaignId}/resume`));
}
export async function cancelCampaign(campaignId: string, reason?: string) {
  return unwrap<CampaignProgress>(await api.post(`/api/campaigns/${campaignId}/cancel`, { reason }));
}

export interface CampaignRecipientIssue {
  id: string;
  skipReason?: string | null;
  errorMessage?: string | null;
  errorCategory?: string | null;
  customer: { id: string; fullName: string; phone: string };
}
export async function getSkippedRecipients(campaignId: string) {
  return unwrap<{ items: CampaignRecipientIssue[]; meta: { page: number; limit: number; total: number } }>(await api.get(`/api/campaigns/${campaignId}/skipped-recipients`));
}
export async function getCampaignFailures(campaignId: string) {
  return unwrap<{ items: CampaignRecipientIssue[]; meta: { page: number; limit: number; total: number } }>(await api.get(`/api/campaigns/${campaignId}/failures`));
}
