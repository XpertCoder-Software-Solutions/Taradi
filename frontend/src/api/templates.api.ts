import { api, unwrap } from "../lib/api";
import type {
  Message,
  WhatsappTemplate,
  WhatsappTemplateMapping,
  WhatsappTemplateMappingField,
  WhatsappTemplateSyncSummary,
  WhatsappTemplateTransformer,
  WhatsappTemplateVariable,
  WhatsappTemplatesResponse
} from "../types/api";

export interface WhatsappTemplateFilters {
  status?: string;
  category?: string;
  language?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface SendWhatsappTemplatePayload {
  customerId: string;
  templateName: string;
  language: string;
  parameters: string[];
}

export async function listWhatsappTemplates(filters: WhatsappTemplateFilters = {}) {
  return unwrap<WhatsappTemplatesResponse>(await api.get("/api/whatsapp/templates", { params: filters }));
}

export async function syncWhatsappTemplates() {
  return unwrap<WhatsappTemplateSyncSummary>(await api.post("/api/whatsapp/templates/sync"));
}

export async function getWhatsappTemplateMappingFields() {
  return unwrap<{
    fields: WhatsappTemplateMappingField[];
    transformers: WhatsappTemplateTransformer[];
    defaultProfiles: Record<string, Array<{
      placeholderNumber: number;
      fieldKey: string;
      transformer?: string | null;
      fallbackValue?: string | null;
    }>>;
  }>(await api.get("/api/whatsapp/templates/mapping-fields"));
}

export async function getWhatsappTemplateMapping(templateId: string) {
  return unwrap<{
    template: WhatsappTemplate;
    variables: WhatsappTemplateVariable[];
    mappings: WhatsappTemplateMapping[];
    missingVariables: WhatsappTemplateVariable[];
    isComplete: boolean;
    message?: string | null;
  }>(await api.get(`/api/whatsapp/templates/${templateId}/mapping`));
}

export async function saveWhatsappTemplateMapping(templateId: string, mappings: Array<{
  variableKey: string;
  fieldKey: string;
  transformer?: string | null;
  fallbackValue?: string | null;
}>) {
  return unwrap<{
    template: WhatsappTemplate;
    variables: WhatsappTemplateVariable[];
    mappings: WhatsappTemplateMapping[];
    missingVariables: WhatsappTemplateVariable[];
    isComplete: boolean;
    message?: string | null;
  }>(await api.put(`/api/whatsapp/templates/${templateId}/mapping`, { mappings }));
}

export async function sendWhatsappTemplate(payload: SendWhatsappTemplatePayload) {
  return unwrap<{
    message: Message;
    whatsappMessageId?: string | null;
  }>(await api.post("/api/whatsapp/messages/template", payload));
}
