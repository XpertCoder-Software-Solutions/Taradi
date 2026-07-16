import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Save, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getWhatsappTemplateMapping,
  getWhatsappTemplateMappingFields,
  listWhatsappTemplates,
  saveWhatsappTemplateMapping
} from "../api/templates.api";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { FieldShell, Input, Select } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/States";
import { useToast } from "../contexts/ToastContext";
import { translateApiError } from "../lib/i18n";
import type { WhatsappTemplate, WhatsappTemplateVariable } from "../types/api";

type MappingDraft = Record<string, {
  fieldKey: string;
  transformer: string;
  fallbackValue: string;
}>;

function normalizeForSearch(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function filterTemplates(templates: WhatsappTemplate[], search: string) {
  const normalizedSearch = normalizeForSearch(search);

  if (!normalizedSearch) {
    return templates;
  }

  return templates.filter((template) => [
    template.name,
    template.language,
    template.category || "",
    template.status
  ].some((value) => normalizeForSearch(value).includes(normalizedSearch)));
}

function variableKey(variable: WhatsappTemplateVariable) {
  return variable.variableKey || [
    variable.componentType || variable.component,
    variable.buttonIndex ?? "",
    variable.source || "",
    variable.placeholderNumber || variable.index
  ].join(":");
}

function variableToken(variable: WhatsappTemplateVariable) {
  return variable.token || `{{${variable.placeholderNumber || variable.index}}}`;
}

function describeVariable(variable: WhatsappTemplateVariable) {
  const component = variable.componentType || variable.component;
  const componentLabels: Record<string, string> = {
    header: "الرأس",
    body: "النص",
    footer: "التذييل",
    button: "زر"
  };
  const label = componentLabels[component] || component;

  if (component === "button" && Number.isInteger(variable.buttonIndex)) {
    return `${label} ${Number(variable.buttonIndex) + 1}`;
  }

  return label;
}

export function TemplateMappingsPage() {
  const [search, setSearch] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [draft, setDraft] = useState<MappingDraft>({});
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const templatesQuery = useQuery({
    queryKey: ["whatsapp-templates", "mapping-admin"],
    queryFn: () => listWhatsappTemplates({ status: "ALL", limit: 100 })
  });

  const fieldsQuery = useQuery({
    queryKey: ["whatsapp-template-mapping-fields"],
    queryFn: getWhatsappTemplateMappingFields
  });

  const templates = templatesQuery.data?.items || [];
  const filteredTemplates = useMemo(() => filterTemplates(templates, search), [search, templates]);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates]
  );

  const mappingQuery = useQuery({
    queryKey: ["whatsapp-template-mapping", selectedTemplateId],
    queryFn: () => getWhatsappTemplateMapping(selectedTemplateId),
    enabled: Boolean(selectedTemplateId)
  });

  useEffect(() => {
    if (!selectedTemplateId && filteredTemplates[0]) {
      setSelectedTemplateId(filteredTemplates[0].id);
    }
  }, [filteredTemplates, selectedTemplateId]);

  useEffect(() => {
    const nextDraft: MappingDraft = {};

    for (const mapping of mappingQuery.data?.mappings || []) {
      nextDraft[mapping.variableKey] = {
        fieldKey: mapping.fieldKey,
        transformer: mapping.transformer || "",
        fallbackValue: mapping.fallbackValue || ""
      };
    }

    setDraft(nextDraft);
  }, [mappingQuery.data?.mappings]);

  const fields = fieldsQuery.data?.fields || [];
  const transformers = fieldsQuery.data?.transformers || [];
  const fieldByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) {
        throw new Error("اختر قالبًا أولًا");
      }

      const mappings = (mappingQuery.data?.variables || [])
        .map((variable) => {
          const key = variableKey(variable);
          const value = draft[key];

          if (!value?.fieldKey) {
            return null;
          }

          const field = fieldByKey.get(value.fieldKey);

          return {
            variableKey: key,
            fieldKey: value.fieldKey,
            transformer: value.transformer || field?.defaultTransformer || null,
            fallbackValue: value.fallbackValue || null
          };
        })
        .filter(Boolean) as Array<{
          variableKey: string;
          fieldKey: string;
          transformer?: string | null;
          fallbackValue?: string | null;
        }>;

      return saveWhatsappTemplateMapping(selectedTemplateId, mappings);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-template-mapping", selectedTemplateId] });
      pushToast({ title: "تم حفظ الربط", description: "سيستخدم هذا القالب الربط المحفوظ في الحملات القادمة.", tone: "success" });
    },
    onError: (error) => pushToast({ title: "تعذر حفظ الربط", description: translateApiError(error), tone: "error" })
  });

  function updateDraft(variable: WhatsappTemplateVariable, key: keyof MappingDraft[string], value: string) {
    const id = variableKey(variable);
    setDraft((current) => ({
      ...current,
      [id]: {
        fieldKey: current[id]?.fieldKey || "",
        transformer: current[id]?.transformer || "",
        fallbackValue: current[id]?.fallbackValue || "",
        [key]: value
      }
    }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Template Mappings"
        description="اربط متغيرات قوالب Meta بحقول العملاء مرة واحدة، ثم تستخدمها الحملات تلقائيًا."
        action={selectedTemplate ? <Badge tone={mappingQuery.data?.isComplete ? "green" : "amber"}>{mappingQuery.data?.isComplete ? "مكتمل" : "بحاجة ربط"}</Badge> : null}
      />

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader
            title="القوالب"
            description="كل القوالب المتزامنة من Meta."
            action={(
              <div className="relative w-full">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                <Input className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث" />
              </div>
            )}
          />
          {templatesQuery.isLoading ? <LoadingState label="جاري تحميل القوالب..." /> : null}
          {templatesQuery.error ? <ErrorState error={templatesQuery.error} /> : null}
          {!templatesQuery.isLoading && !templatesQuery.error && filteredTemplates.length === 0 ? (
            <EmptyState title="لا توجد قوالب" description="قم بمزامنة قوالب Meta أولاً." />
          ) : null}
          {filteredTemplates.length ? (
            <div className="max-h-[680px] divide-y divide-surface-200 overflow-auto">
              {filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                  className={`w-full px-5 py-4 text-right transition ${selectedTemplateId === template.id ? "bg-mint-50" : "hover:bg-surface-50"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-black text-ink-900" dir="ltr">{template.name}</p>
                      <p className="mt-1 text-xs font-bold text-ink-500">{template.language} · {template.category || "بدون تصنيف"}</p>
                    </div>
                    <Badge tone={template.status === "APPROVED" ? "green" : "amber"}>{template.status}</Badge>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title={selectedTemplate ? selectedTemplate.name : "اختر قالبًا"}
            description={selectedTemplate ? `${selectedTemplate.language} · ${selectedTemplate.category || "بدون تصنيف"}` : "اختر قالبًا من القائمة لعرض متغيراته."}
            action={selectedTemplate ? (
              <Button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || mappingQuery.isLoading}
                icon={<Save className="h-4 w-4" />}
              >
                حفظ الربط
              </Button>
            ) : null}
          />
          <CardBody className="space-y-4">
            {fieldsQuery.isLoading || mappingQuery.isLoading ? <LoadingState label="جاري تحميل بيانات الربط..." /> : null}
            {fieldsQuery.error ? <ErrorState error={fieldsQuery.error} /> : null}
            {mappingQuery.error ? <ErrorState error={mappingQuery.error} /> : null}
            {!selectedTemplate ? <EmptyState title="اختر قالبًا" description="سيظهر ربط المتغيرات هنا." /> : null}
            {selectedTemplate && mappingQuery.data?.variables.length === 0 ? (
              <EmptyState title="لا توجد متغيرات" description="هذا القالب لا يحتوي على placeholders." />
            ) : null}
            {mappingQuery.data?.message ? (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
                {mappingQuery.data.message}
              </div>
            ) : null}
            {mappingQuery.data?.variables.map((variable) => {
              const key = variableKey(variable);
              const value = draft[key] || { fieldKey: "", transformer: "", fallbackValue: "" };
              const selectedField = fieldByKey.get(value.fieldKey);

              return (
                <div key={key} className="grid gap-3 rounded-2xl border border-surface-200 bg-white p-4 lg:grid-cols-[180px_1fr_180px_180px]">
                  <div>
                    <p className="font-black text-ink-900">{variableToken(variable)}</p>
                    <p className="mt-1 text-xs font-bold text-ink-500">{describeVariable(variable)}</p>
                  </div>
                  <FieldShell label="حقل العميل">
                    <Select value={value.fieldKey} onChange={(event) => updateDraft(variable, "fieldKey", event.target.value)}>
                      <option value="">اختر الحقل</option>
                      {fields.map((field) => (
                        <option key={field.key} value={field.key}>{field.labelAr}</option>
                      ))}
                    </Select>
                  </FieldShell>
                  <FieldShell label="Transformer">
                    <Select value={value.transformer || selectedField?.defaultTransformer || ""} onChange={(event) => updateDraft(variable, "transformer", event.target.value)}>
                      <option value="">بدون</option>
                      {transformers.map((transformer) => (
                        <option key={transformer.key} value={transformer.key}>{transformer.labelAr}</option>
                      ))}
                    </Select>
                  </FieldShell>
                  <FieldShell label="Fallback">
                    <Input value={value.fallbackValue} onChange={(event) => updateDraft(variable, "fallbackValue", event.target.value)} placeholder="اختياري" />
                  </FieldShell>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
