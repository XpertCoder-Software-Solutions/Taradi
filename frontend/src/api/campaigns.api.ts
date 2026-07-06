import { api, unwrap } from "../lib/api";

export interface CreateCampaignPayload {
  customerIds: string[];
  templateName: string;
  languageCode: string;
  components?: unknown[];
}

export interface CampaignResult {
  customerId: string;
  messageId: string;
  jobId?: string;
  status: "QUEUED" | "FAILED";
  error?: string;
}

export interface CampaignExcludedCustomer {
  customerId: string;
  fullName: string;
  reason: string;
}

export interface CampaignResponse {
  totalSelected?: number;
  eligibleRecipients?: number;
  excludedBlockedCustomers?: number;
  excludedCustomers?: CampaignExcludedCustomer[];
  total: number;
  queued: number;
  failed: number;
  results: CampaignResult[];
}

export async function createBulkCampaign(payload: CreateCampaignPayload) {
  return unwrap<CampaignResponse>(await api.post("/api/whatsapp/templates/bulk", payload));
}
