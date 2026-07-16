import { useQuery } from "@tanstack/react-query";
import { FileText, Languages, Loader2, Search, Send, Tags } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { listWhatsappTemplates } from "../../api/templates.api";
import type { Conversation, WhatsappTemplate } from "../../types/api";
import { Button } from "../ui/Button";
import { FieldShell, Input, Select } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { EmptyState, ErrorState, LoadingState } from "../ui/States";

export interface SendTemplateFormPayload {
  templateName: string;
  language: string;
  parameters: string[];
}

const statusLabel: Record<string, string> = {
  APPROVED: "معتمد",
  PENDING: "قيد المراجعة",
  REJECTED: "مرفوض",
  DISABLED: "معطل"
};

function replaceVariables(text: string | null | undefined, parameters: Record<number, string>) {
  return (text || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, rawIndex) => {
    const index = Number(rawIndex);
    return parameters[index] || `{{${index}}}`;
  });
}

function getVariableIndexes(template: WhatsappTemplate | null) {
  const indexes = new Set<number>();

  for (const variable of template?.variables || []) {
    if (Number.isInteger(variable.index) && variable.index > 0) {
      indexes.add(variable.index);
    }
  }

  return [...indexes].sort((a, b) => a - b);
}

function buildParameterArray(indexes: number[], values: Record<number, string>) {
  const maxIndex = Math.max(0, ...indexes);
  const parameters = Array.from({ length: maxIndex }, () => "");

  indexes.forEach((index) => {
    parameters[index - 1] = values[index]?.trim() || "";
  });

  return parameters;
}

function normalizeForSearch(value: string) {
  return value.trim().toLowerCase();
}

function filterTemplates(
  templates: WhatsappTemplate[],
  filters: { search: string; category: string; language: string }
) {
  const search = normalizeForSearch(filters.search);

  return templates.filter((template) => {
    const matchesSearch = !search || [
      template.name,
      template.body || "",
      template.headerText || "",
      template.footer || ""
    ].some((value) => normalizeForSearch(value).includes(search));
    const matchesCategory = !filters.category || template.category === filters.category;
    const matchesLanguage = !filters.language || template.language === filters.language;

    return matchesSearch && matchesCategory && matchesLanguage;
  });
}

function categoryLabel(category?: string | null) {
  if (!category) {
    return "بدون تصنيف";
  }

  return category;
}

export function TemplateSendModal({
  open,
  conversation,
  onClose,
  onSubmit,
  isSubmitting
}: {
  open: boolean;
  conversation: Conversation | null;
  onClose: () => void;
  onSubmit: (payload: SendTemplateFormPayload) => Promise<void>;
  isSubmitting: boolean;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [parameterValues, setParameterValues] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["whatsapp-templates", "approved"],
    queryFn: () => listWhatsappTemplates({ status: "APPROVED" }),
    enabled: open
  });

  const templates = templatesQuery.data?.items || [];
  const filteredTemplates = useMemo(
    () => filterTemplates(templates, { search, category, language }),
    [category, language, search, templates]
  );
  const selectedTemplate = useMemo(
    () => filteredTemplates.find((template) => template.id === selectedTemplateId) || filteredTemplates[0] || null,
    [filteredTemplates, selectedTemplateId]
  );
  const variableIndexes = useMemo(() => getVariableIndexes(selectedTemplate), [selectedTemplate]);
  const categories = useMemo(() => [...new Set(templates.map((template) => template.category).filter(Boolean) as string[])].sort(), [templates]);
  const languages = useMemo(() => [...new Set(templates.map((template) => template.language))].sort(), [templates]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setCategory("");
      setLanguage("");
      setSelectedTemplateId("");
      setParameterValues({});
      setFormError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!selectedTemplate || selectedTemplate.id === selectedTemplateId) {
      return;
    }

    setSelectedTemplateId(selectedTemplate.id);
    setParameterValues({});
    setFormError(null);
  }, [selectedTemplate, selectedTemplateId]);

  function updateParameter(index: number, value: string) {
    setParameterValues((current) => ({
      ...current,
      [index]: value
    }));
    setFormError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedTemplate) {
      setFormError("اختر قالبًا أولًا");
      return;
    }

    const missing = variableIndexes.filter((index) => !parameterValues[index]?.trim());

    if (missing.length > 0) {
      setFormError("أكمل متغيرات القالب قبل الإرسال");
      return;
    }

    try {
      await onSubmit({
        templateName: selectedTemplate.name,
        language: selectedTemplate.language,
        parameters: buildParameterArray(variableIndexes, parameterValues)
      });
    } catch {
      // Parent mutation shows API errors through the shared toast system.
    }
  }

  return (
    <Modal
      open={open}
      title="إرسال قالب واتساب"
      description={conversation?.customer ? `إلى ${conversation.customer.fullName || conversation.customer.name || conversation.customer.phone}` : undefined}
      onClose={isSubmitting ? () => undefined : onClose}
      className="max-w-5xl"
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            إلغاء
          </Button>
          <Button
            type="submit"
            form="send-template-form"
            disabled={isSubmitting || !selectedTemplate}
            icon={isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          >
            إرسال القالب
          </Button>
        </div>
      )}
    >
      <form id="send-template-form" className="grid gap-5 lg:grid-cols-[minmax(260px,360px)_1fr]" onSubmit={submit}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="relative sm:col-span-3 lg:col-span-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <Input className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث في القوالب" />
            </div>

            <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="التصنيف">
              <option value="">كل التصنيفات</option>
              {categories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
            </Select>

            <Select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="اللغة">
              <option value="">كل اللغات</option>
              {languages.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </div>

          <div className="max-h-[350px] space-y-2 overflow-auto rounded-2xl border border-surface-200 bg-surface-50 p-2">
            {templatesQuery.isLoading ? <LoadingState label="جاري تحميل القوالب..." /> : null}
            {templatesQuery.error ? <ErrorState error={templatesQuery.error} /> : null}
            {!templatesQuery.isLoading && !templatesQuery.error && filteredTemplates.length === 0 ? (
              <EmptyState title="لا توجد قوالب معتمدة" description="زامن قوالب واتساب من صفحة القوالب أولًا." />
            ) : null}
            {filteredTemplates.map((template) => {
              const isSelected = selectedTemplate?.id === template.id;

              return (
                <button
                  key={template.id}
                  type="button"
                  className={`w-full rounded-2xl border px-3 py-3 text-right transition ${isSelected ? "border-mint-200 bg-white shadow-sm ring-4 ring-mint-100" : "border-transparent bg-white/70 hover:border-mint-100 hover:bg-white"}`}
                  onClick={() => {
                    setSelectedTemplateId(template.id);
                    setParameterValues({});
                    setFormError(null);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-ink-900" dir="ltr">{template.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">{template.body || template.headerText || "قالب بدون نص"}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-mint-50 px-2.5 py-1 text-[11px] font-black text-mint-800">
                      {statusLabel[template.status] || template.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-ink-500">
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-2 py-1"><Tags className="h-3 w-3" />{categoryLabel(template.category)}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-2 py-1"><Languages className="h-3 w-3" />{template.language}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-2 py-1"><FileText className="h-3 w-3" />{template.variables.length} متغير</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          {selectedTemplate ? (
            <>
              <div className="rounded-2xl border border-surface-200 bg-[#efeae2] p-4">
                <div className="max-w-[520px] rounded-2xl rounded-tr-sm bg-white px-4 py-3 text-sm leading-7 text-ink-900 shadow-sm">
                  {selectedTemplate.headerText ? (
                    <p className="mb-2 font-black">{replaceVariables(selectedTemplate.headerText, parameterValues)}</p>
                  ) : selectedTemplate.headerType && selectedTemplate.headerType !== "TEXT" ? (
                    <div className="mb-2 rounded-xl border border-dashed border-surface-300 bg-surface-50 px-3 py-2 text-xs font-bold text-ink-500">
                      رأس قالب {selectedTemplate.headerType}
                    </div>
                  ) : null}

                  {selectedTemplate.body ? (
                    <p className="whitespace-pre-wrap">{replaceVariables(selectedTemplate.body, parameterValues)}</p>
                  ) : null}

                  {selectedTemplate.footer ? (
                    <p className="mt-3 text-xs font-semibold text-ink-400">{replaceVariables(selectedTemplate.footer, parameterValues)}</p>
                  ) : null}

                  {selectedTemplate.buttons.length > 0 ? (
                    <div className="mt-3 grid gap-2 border-t border-surface-100 pt-3">
                      {selectedTemplate.buttons.map((button, index) => (
                        <div key={`${button.text || button.type}-${index}`} className="rounded-xl bg-surface-50 px-3 py-2 text-center text-xs font-black text-mint-700">
                          {button.text || button.type || "زر"}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {variableIndexes.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {variableIndexes.map((index) => (
                    <FieldShell key={index} label={`متغير ${index}`}>
                      <Input
                        value={parameterValues[index] || ""}
                        onChange={(event) => updateParameter(index, event.target.value)}
                        placeholder={`قيمة {{${index}}}`}
                        disabled={isSubmitting}
                      />
                    </FieldShell>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-mint-100 bg-mint-50 px-4 py-3 text-sm font-bold text-mint-800">
                  هذا القالب لا يحتوي على متغيرات.
                </div>
              )}

              {formError ? <p className="text-sm font-bold text-red-700">{formError}</p> : null}
            </>
          ) : (
            <EmptyState title="اختر قالبًا للمعاينة" />
          )}
        </div>
      </form>
    </Modal>
  );
}
