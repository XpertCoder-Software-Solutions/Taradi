import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CheckSquare,
  FileText,
  Languages,
  MinusSquare,
  Search,
  Send,
  Square,
  Tags
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  createBulkCampaign,
  getCampaignProgress,
  previewBulkCampaign,
  type CampaignProgress,
  type CampaignPreviewResponse
} from "../api/campaigns.api";
import { listCustomers, type CustomerFilters } from "../api/customers.api";
import {
  getWhatsappTemplateMapping,
  getWhatsappTemplateMappingFields,
  listWhatsappTemplates
} from "../api/templates.api";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { FieldShell, Input, Select } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/States";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { translateApiError } from "../lib/i18n";
import type { CollectionStatus, Customer, InvoiceStatus, WhatsappTemplate, WhatsappTemplateMapping, WhatsappTemplateVariable } from "../types/api";

const statusLabel: Record<string, string> = {
  APPROVED: "معتمد",
  PENDING: "قيد المراجعة",
  REJECTED: "مرفوض",
  PAUSED: "متوقف مؤقتًا",
  DISABLED: "معطل",
  IN_APPEAL: "قيد الاعتراض",
  PENDING_DELETION: "قيد الحذف"
};

const statusTone: Record<string, "green" | "amber" | "red" | "neutral"> = {
  APPROVED: "green",
  PENDING: "amber",
  REJECTED: "red",
  PAUSED: "amber",
  DISABLED: "neutral",
  IN_APPEAL: "amber",
  PENDING_DELETION: "neutral"
};

const campaignStatusLabel: Record<string, string> = {
  DRAFT: "مسودة",
  PREPARING: "جاري التجهيز",
  READY: "جاهزة",
  QUEUED: "في قائمة الانتظار",
  RUNNING: "قيد الإرسال",
  PAUSED: "متوقفة مؤقتًا",
  COMPLETED: "مكتملة",
  COMPLETED_WITH_ERRORS: "اكتملت مع أخطاء",
  FAILED: "فشلت",
  CANCELLED: "ملغاة"
};

const terminalCampaignStatuses = new Set(["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"]);
const customerPageSizeOptions = [25, 50, 100];
const projectNameOptions = ["STC", "Mobily"] as const;
const invoiceStatusOptions: Array<{ value: InvoiceStatus; label: string }> = [
  { value: "UNPAID", label: "غير مدفوعة" },
  { value: "PAID", label: "مدفوعة" },
  { value: "SCHEDULED", label: "مجدولة" },
  { value: "DISPUTED", label: "متنازع عليها" },
  { value: "CANCELLED", label: "ملغية" }
];
const collectionStatusOptions: Array<{ value: CollectionStatus; label: string }> = [
  { value: "ACTIVE_DEBT", label: "مديونية قائمة" },
  { value: "PAID", label: "تم السداد" },
  { value: "PARTIALLY_PAID", label: "سداد جزئي" },
  { value: "PROMISED_TO_PAY", label: "وعد بالسداد" },
  { value: "DISPUTED", label: "متنازع عليها" },
  { value: "DO_NOT_CONTACT", label: "ممنوع التواصل" }
];

function customerCanReceiveCampaign(customer: Customer) {
  return !customer.contactBlocked;
}

function hasValidCampaignPhone(customer: Customer) {
  const phone = String(customer.primaryPhone || customer.phone || "").replace(/\D/g, "");
  return phone.length >= 6;
}

function customerCampaignBlockReason(customer: Customer) {
  if (customer.contactBlocked) {
    return customer.collectionStatusLabel || "ممنوع التواصل";
  }

  if (!hasValidCampaignPhone(customer)) {
    return "رقم الهاتف غير صالح";
  }

  return "غير مؤهل للإرسال";
}

function normalizeForSearch(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function categoryLabel(category?: string | null) {
  return category || "بدون تصنيف";
}

function templateVariableKey(variable: WhatsappTemplateVariable) {
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

function filterTemplates(templates: WhatsappTemplate[], search: string) {
  const normalizedSearch = normalizeForSearch(search);

  if (!normalizedSearch) {
    return templates;
  }

  return templates.filter((template) => [
    template.name,
    template.language,
    template.category || "",
    template.status,
    template.body || "",
    template.headerText || "",
    template.footer || ""
  ].some((value) => normalizeForSearch(value).includes(normalizedSearch)));
}

function mappingByKey(mappings: WhatsappTemplateMapping[] = []) {
  return new Map(mappings.map((mapping) => [mapping.variableKey, mapping]));
}

function buildSelectionPayload(
  templateId: string,
  selectionMode: "explicit" | "all_matching",
  selectedIds: string[],
  filters: CustomerFilters,
  excludedCustomerIds: string[] = []
) {
  const normalizedCustomerIds = [...selectedIds].sort();
  const normalizedExcludedCustomerIds = [...excludedCustomerIds].sort();

  return {
    templateId,
    selectionMode,
    customerIds: selectionMode === "explicit" ? normalizedCustomerIds : [],
    excludedCustomerIds: normalizedExcludedCustomerIds,
    filters: selectionMode === "all_matching" ? filters : undefined
  };
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `campaign-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isCanceledRequest(error: unknown) {
  const candidate = error as { name?: string; code?: string } | null;

  return candidate?.name === "CanceledError" || candidate?.code === "ERR_CANCELED";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-bold text-mint-700">{label}</p>
      <p className="mt-1 text-2xl font-black text-ink-900">{value}</p>
    </div>
  );
}

export function CampaignsPage() {
  const { hasPermission } = useAuth();
  const canSendCampaign = hasPermission("campaigns.send");
  const [searchParams] = useSearchParams();
  const preselectedCustomerId = searchParams.get("customerId");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [customerPage, setCustomerPage] = useState(1);
  const [customerPageSize, setCustomerPageSize] = useState(25);
  const [projectNameFilter, setProjectNameFilter] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<InvoiceStatus | "">("");
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<CollectionStatus | "">("");
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState<"assigned" | "unassigned" | "">("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => preselectedCustomerId ? [preselectedCustomerId] : []);
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CampaignProgress | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CampaignPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewPayloadKeyRef = useRef("");
  const { pushToast } = useToast();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    setCustomerPage(1);
  }, [debouncedSearch, projectNameFilter, invoiceStatusFilter, collectionStatusFilter, assignmentStatusFilter, customerPageSize]);

  const customerFilters = useMemo<CustomerFilters>(() => ({
    search: debouncedSearch || undefined,
    ...(projectNameFilter ? { projectName: projectNameFilter } : {}),
    ...(invoiceStatusFilter ? { invoiceStatus: invoiceStatusFilter } : {}),
    ...(collectionStatusFilter ? { collectionStatus: collectionStatusFilter } : {}),
    ...(assignmentStatusFilter ? { assignmentStatus: assignmentStatusFilter } : {}),
    sortBy: "createdAt",
    sortOrder: "desc"
  }), [assignmentStatusFilter, collectionStatusFilter, debouncedSearch, invoiceStatusFilter, projectNameFilter]);

  const customersQuery = useQuery({
    queryKey: ["customers", "campaigns", customerFilters, customerPage, customerPageSize],
    queryFn: ({ signal }) => listCustomers({
      ...customerFilters,
      page: customerPage,
      limit: customerPageSize
    }, signal),
    placeholderData: keepPreviousData
  });

  const templatesQuery = useQuery({
    queryKey: ["whatsapp-templates", "campaigns"],
    queryFn: () => listWhatsappTemplates({ status: "ALL", limit: 100 })
  });

  const mappingFieldsQuery = useQuery({
    queryKey: ["whatsapp-template-mapping-fields"],
    queryFn: getWhatsappTemplateMappingFields
  });

  const templates = templatesQuery.data?.items || [];
  const filteredTemplates = useMemo(
    () => filterTemplates(templates, templateSearch),
    [templateSearch, templates]
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates]
  );
  const selectedLanguageCode = selectedTemplate?.language || "";
  const selectionMode: "explicit" | "all_matching" = selectAllMatching ? "all_matching" : "explicit";
  const totalMatchingCustomers = customersQuery.data?.meta.total || 0;
  const estimatedSelectedCustomers = selectionMode === "all_matching"
    ? Math.max(totalMatchingCustomers - excludedIds.length, 0)
    : selectedIds.length;
  const totalCustomerPages = Math.max(Math.ceil(totalMatchingCustomers / customerPageSize), 1);
  const visibleCustomers = customersQuery.data?.items || [];
  const visibleIds = visibleCustomers.map((customer) => customer.id);
  const checkedVisibleCount = visibleIds.filter((id) => selectAllMatching ? !excludedIds.includes(id) : selectedIds.includes(id)).length;
  const isCurrentPageChecked = visibleIds.length > 0 && checkedVisibleCount === visibleIds.length;
  const hasCustomerSelection = estimatedSelectedCustomers > 0;

  const templateMappingQuery = useQuery({
    queryKey: ["whatsapp-template-mapping", selectedTemplateId],
    queryFn: () => getWhatsappTemplateMapping(selectedTemplateId),
    enabled: Boolean(selectedTemplateId)
  });

  const mappingFieldsByKey = useMemo(() => new Map(
    (mappingFieldsQuery.data?.fields || []).map((field) => [field.key, field])
  ), [mappingFieldsQuery.data?.fields]);
  const templateMappingsByKey = useMemo(
    () => mappingByKey(templateMappingQuery.data?.mappings),
    [templateMappingQuery.data?.mappings]
  );
  const mappingVariables = templateMappingQuery.data?.variables || preview?.mapping.variables || [];
  const mappingMessage = templateMappingQuery.data?.message || preview?.mapping.message || null;
  const mappingComplete = templateMappingQuery.data?.isComplete ?? preview?.mapping.isComplete ?? false;
  const canLoadPreview = Boolean(
    selectedTemplateId &&
    selectedTemplate?.status === "APPROVED" &&
    hasCustomerSelection &&
    canSendCampaign &&
    mappingComplete &&
    !templateMappingQuery.isLoading
  );
  const previewPayload = useMemo(() => canLoadPreview
    ? {
        ...buildSelectionPayload(selectedTemplateId, selectionMode, selectedIds, customerFilters, excludedIds),
        limit: 3
      }
    : null,
  [canLoadPreview, customerFilters, excludedIds, selectedIds, selectedTemplateId, selectionMode]);
  const previewPayloadKey = useMemo(() => previewPayload ? JSON.stringify(previewPayload) : "", [previewPayload]);

  const campaignProgressQuery = useQuery({
    queryKey: ["campaign-progress", activeCampaignId],
    queryFn: () => getCampaignProgress(activeCampaignId || ""),
    enabled: Boolean(activeCampaignId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;

      return status && terminalCampaignStatuses.has(status) ? false : 5000;
    }
  });

  useEffect(() => {
    setValidationError(null);
  }, [customerFilters, excludedIds, selectedIds, selectAllMatching, selectedTemplateId]);

  useEffect(() => {
    previewAbortRef.current?.abort();

    if (!previewPayload || !previewPayloadKey) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      previewPayloadKeyRef.current = "";
      return;
    }

    if (previewPayloadKeyRef.current === previewPayloadKey) {
      setPreviewLoading(false);
      return;
    }

    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);

    const controller = new AbortController();
    previewAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => {
      previewBulkCampaign(previewPayload, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) {
            return;
          }

          previewPayloadKeyRef.current = previewPayloadKey;
          setPreview(result);
          setPreviewError(null);
        })
        .catch((error) => {
          if (controller.signal.aborted || isCanceledRequest(error)) {
            return;
          }

          previewPayloadKeyRef.current = "";
          setPreview(null);
          setPreviewError(error);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setPreviewLoading(false);
          }
        });
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [previewPayload, previewPayloadKey]);

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }

    selectAllRef.current.indeterminate = checkedVisibleCount > 0 && checkedVisibleCount < visibleIds.length;
  }, [checkedVisibleCount, visibleIds.length]);

  const campaignProgress = campaignProgressQuery.data || lastResult;
  const metrics = {
    selected: preview?.totalSelected ?? campaignProgress?.selected ?? estimatedSelectedCustomers,
    eligible: preview?.eligibleRecipients ?? campaignProgress?.eligible ?? 0,
    skipped: preview?.skippedCustomers ?? campaignProgress?.skipped ?? 0,
    invalidPhones: preview?.invalidPhoneNumbers ?? 0,
    estimated: preview?.estimatedSendCount ?? campaignProgress?.eligible ?? 0
  };

  const prepareValidationError = useMemo(() => {
    if (!selectedTemplate) {
      return "اختر قالبًا معتمدًا قبل تجهيز الحملة";
    }

    if (selectedTemplate.status !== "APPROVED") {
      return "لا يمكن إرسال الحملة إلا بقالب معتمد من Meta";
    }

    if (selectedLanguageCode !== selectedTemplate.language) {
      return "لغة القالب لا تطابق اللغة المختارة";
    }

    if (!hasCustomerSelection) {
      return "اختر عميلًا واحدًا على الأقل";
    }

    if (templateMappingQuery.isLoading || previewLoading) {
      return "جاري التحقق من ربط القالب والعملاء";
    }

    if (!mappingComplete) {
      return mappingMessage || "أكمل ربط متغيرات هذا القالب قبل تجهيز الحملة";
    }

    if (preview?.template.language && preview.template.language !== selectedTemplate.language) {
      return "لغة القالب لا تطابق القالب المختار";
    }

    if (previewError) {
      return translateApiError(previewError);
    }

    if (canLoadPreview && !preview) {
      return "جاري تجهيز المعاينة";
    }

    if (metrics.estimated === 0) {
      return "لا يوجد عملاء مؤهلون للإرسال";
    }

    return null;
  }, [
    canLoadPreview,
    hasCustomerSelection,
    mappingComplete,
    mappingMessage,
    metrics.estimated,
    preview,
    previewError,
    previewLoading,
    selectedLanguageCode,
    selectedTemplate,
    templateMappingQuery.isLoading
  ]);

  const campaignMutation = useMutation({
    mutationFn: async () => createBulkCampaign({
      ...buildSelectionPayload(
        selectedTemplateId,
        selectionMode,
        selectedIds,
        customerFilters,
        excludedIds
      ),
      idempotencyKey: createIdempotencyKey()
    }),
    onSuccess: (result) => {
      setLastResult(result);
      setActiveCampaignId(result.campaignId || result.id);
      pushToast({
        title: result.message || "تمت إضافة الحملة إلى قائمة الإرسال",
        description: `${result.recipientCount || result.selected || 0} عميل في نطاق الحملة. سيظهر التقدم هنا أثناء التجهيز والإرسال.`,
        tone: "success"
      });
    },
    onError: (error) => pushToast({ title: "تعذر تجهيز الحملة", description: translateApiError(error), tone: "error" })
  });

  function selectTemplate(template: WhatsappTemplate) {
    if (template.status !== "APPROVED") {
      setValidationError("لا يمكن اختيار قالب غير معتمد للإرسال");
      return;
    }

    setSelectedTemplateId(template.id);
    setValidationError(null);
  }

  function prepareCampaign() {
    if (prepareValidationError) {
      setValidationError(prepareValidationError);
      pushToast({ title: "راجع بيانات الحملة", description: prepareValidationError, tone: "error" });
      return;
    }

    setValidationError(null);
    campaignMutation.mutate();
  }

  function toggleCustomer(id: string) {
    if (selectAllMatching) {
      setExcludedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
      return;
    }

    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleCurrentPage() {
    if (!visibleIds.length) {
      return;
    }

    if (selectAllMatching) {
      setExcludedIds((current) => {
        const visibleSet = new Set(visibleIds);

        return isCurrentPageChecked
          ? [...new Set([...current, ...visibleIds])]
          : current.filter((id) => !visibleSet.has(id));
      });
      return;
    }

    setSelectedIds((current) => {
      const visibleSet = new Set(visibleIds);

      return isCurrentPageChecked
        ? current.filter((id) => !visibleSet.has(id))
        : [...new Set([...current, ...visibleIds])];
    });
  }

  function selectAllSearchResults() {
    setSelectAllMatching(true);
    setSelectedIds([]);
    setExcludedIds([]);
  }

  function clearCustomerSelection() {
    setSelectAllMatching(false);
    setSelectedIds([]);
    setExcludedIds([]);
  }

  const selectAllIcon = selectAllMatching
    ? <CheckSquare className="h-4 w-4" />
    : selectedIds.length > 0 ? <MinusSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الحملات الجماعية"
        description="جهّز حملات واتساب ديناميكية من القوالب المتزامنة وربط المتغيرات المحفوظ."
        action={<Badge tone="green">{metrics.estimated} إرسال متوقع</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-[500px_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="تفاصيل الحملة" description="اختر قالبًا معتمدًا، ثم سيحلّ النظام القيم لكل عميل تلقائيًا." />
            <CardBody className="space-y-5">
              <div className="space-y-3">
                <FieldShell label="بحث في القوالب">
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                    <Input
                      className="pr-9"
                      value={templateSearch}
                      onChange={(event) => setTemplateSearch(event.target.value)}
                      placeholder="ابحث باسم القالب أو اللغة أو التصنيف"
                    />
                  </div>
                </FieldShell>

                <div className="max-h-72 space-y-2 overflow-auto rounded-2xl border border-surface-200 bg-surface-50 p-2">
                  {templatesQuery.isLoading ? <LoadingState label="جاري تحميل القوالب..." /> : null}
                  {templatesQuery.error ? <ErrorState error={templatesQuery.error} /> : null}
                  {!templatesQuery.isLoading && !templatesQuery.error && templates.length === 0 ? (
                    <EmptyState title="لا توجد قوالب" description="لا توجد قوالب. قم بمزامنة قوالب Meta أولاً." />
                  ) : null}
                  {!templatesQuery.isLoading && !templatesQuery.error && templates.length > 0 && filteredTemplates.length === 0 ? (
                    <EmptyState title="لا توجد نتائج" description="جرّب البحث باسم قالب أو لغة مختلفة." />
                  ) : null}

                  {filteredTemplates.map((template) => {
                    const isSelected = selectedTemplate?.id === template.id;
                    const isApproved = template.status === "APPROVED";

                    return (
                      <button
                        key={template.id}
                        type="button"
                        disabled={!isApproved}
                        onClick={() => selectTemplate(template)}
                        className={`w-full rounded-2xl border px-3 py-3 text-right transition disabled:cursor-not-allowed disabled:opacity-60 ${isSelected ? "border-mint-200 bg-white shadow-sm ring-4 ring-mint-100" : "border-transparent bg-white/75 hover:border-mint-100 hover:bg-white"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-ink-900" dir="ltr">{template.name}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">{template.body || template.headerText || "قالب بدون نص"}</p>
                          </div>
                          <Badge tone={statusTone[template.status] || "neutral"}>{statusLabel[template.status] || template.status}</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-ink-500">
                          <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-2 py-1"><Languages className="h-3 w-3" />{template.language}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-2 py-1"><Tags className="h-3 w-3" />{categoryLabel(template.category)}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-2 py-1"><FileText className="h-3 w-3" />{template.variables.length} متغير</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedTemplate ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-surface-200 bg-white px-4 py-3">
                      <p className="text-xs font-bold text-ink-500">اللغة</p>
                      <p className="mt-1 font-black text-ink-900" dir="ltr">{selectedTemplate.language}</p>
                    </div>
                    <div className="rounded-2xl border border-surface-200 bg-white px-4 py-3">
                      <p className="text-xs font-bold text-ink-500">التصنيف</p>
                      <p className="mt-1 font-black text-ink-900">{categoryLabel(selectedTemplate.category)}</p>
                    </div>
                  </div>

                  <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${mappingComplete ? "border-mint-100 bg-mint-50 text-mint-800" : "border-amber-100 bg-amber-50 text-amber-900"}`}>
                    {templateMappingQuery.isLoading ? "جاري تحميل ربط المتغيرات..." : mappingComplete ? "ربط متغيرات القالب مكتمل." : mappingMessage || "أكمل ربط متغيرات هذا القالب قبل تجهيز الحملة."}
                  </div>

                  {mappingVariables.length > 0 ? (
                    <div className="space-y-2">
                      {mappingVariables.map((variable) => {
                        const mapping = templateMappingsByKey.get(templateVariableKey(variable));
                        const field = mapping ? mappingFieldsByKey.get(mapping.fieldKey) : null;

                        return (
                          <div key={templateVariableKey(variable)} className="flex items-center justify-between gap-3 rounded-2xl border border-surface-200 bg-white px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <p className="font-black text-ink-900">{variableToken(variable)} - {describeVariable(variable)}</p>
                              <p className="truncate text-xs font-bold text-ink-500">{field ? field.labelAr : "غير مربوط"}</p>
                            </div>
                            {mapping?.transformer ? <Badge tone="blue">{mapping.transformer}</Badge> : <Badge tone={mapping ? "green" : "amber"}>{mapping ? "مربوط" : "ناقص"}</Badge>}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 rounded-2xl border border-mint-100 bg-mint-50 px-4 py-3 sm:grid-cols-2">
                <Metric label="إجمالي العملاء المختارين" value={metrics.selected} />
                <Metric label="العملاء المؤهلون" value={metrics.eligible} />
                <Metric label="العملاء المستبعدون" value={metrics.skipped} />
                <Metric label="أرقام غير صالحة" value={metrics.invalidPhones} />
                <div className="sm:col-span-2">
                  <Metric label="عدد الإرسال المتوقع" value={metrics.estimated} />
                </div>
              </div>

              {validationError || prepareValidationError ? (
                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                  {validationError || prepareValidationError}
                </div>
              ) : null}

              {canSendCampaign ? (
                <Button
                  className="w-full"
                  size="lg"
                  type="button"
                  disabled={campaignMutation.isPending || Boolean(prepareValidationError)}
                  onClick={prepareCampaign}
                  icon={<Send className="h-4 w-4" />}
                >
                  إضافة الحملة إلى قائمة الإرسال
                </Button>
              ) : null}
            </CardBody>
          </Card>

          {campaignProgress ? (
            <Card>
              <CardHeader
                title="تقدم الحملة"
                description="يتم تجهيز المستلمين وإرسال الرسائل عبر العامل الخلفي."
                action={(
                  <Badge tone={campaignProgress.status === "FAILED" || campaignProgress.status === "CANCELLED" ? "red" : terminalCampaignStatuses.has(campaignProgress.status) ? "green" : "blue"}>
                    {campaignStatusLabel[campaignProgress.status] || campaignProgress.status}
                  </Badge>
                )}
              />
              <CardBody>
                <div className="mb-4">
                  <div className="flex items-center justify-between gap-3 text-xs font-bold text-ink-500">
                    <span>التقدم</span>
                    <span>{campaignProgress.progressPercentage}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-100">
                    <div className="h-full rounded-full bg-mint-700 transition-all" style={{ width: `${campaignProgress.progressPercentage}%` }} />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-2xl bg-surface-50 p-4">
                    <p className="text-sm font-bold text-ink-600">إجمالي النطاق</p>
                    <p className="mt-2 text-3xl font-black text-ink-900">{campaignProgress.selected}</p>
                  </div>
                  <div className="rounded-2xl bg-mint-50 p-4">
                    <p className="text-sm font-bold text-mint-800">مؤهلون</p>
                    <p className="mt-2 text-3xl font-black text-ink-900">{campaignProgress.eligible}</p>
                  </div>
                  <div className="rounded-2xl bg-mint-50 p-4">
                    <p className="text-sm font-bold text-mint-800">في قائمة الإرسال</p>
                    <p className="mt-2 text-3xl font-black text-ink-900">{campaignProgress.queued}</p>
                  </div>
                  <div className="rounded-2xl bg-blue-50 p-4">
                    <p className="text-sm font-bold text-blue-700">تم الإرسال</p>
                    <p className="mt-2 text-3xl font-black text-ink-900">{campaignProgress.sent + campaignProgress.delivered + campaignProgress.read}</p>
                  </div>
                  <div className="rounded-2xl bg-red-50 p-4">
                    <p className="text-sm font-bold text-red-700">فشل</p>
                    <p className="mt-2 text-3xl font-black text-ink-900">{campaignProgress.failed}</p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-4">
                    <p className="text-sm font-bold text-amber-800">مستبعدون</p>
                    <p className="mt-2 text-3xl font-black text-ink-900">{campaignProgress.skipped}</p>
                  </div>
                </div>

                {campaignProgress.error ? (
                  <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                    {campaignProgress.error}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="المستلمون"
              description="اختر عملاء محددين أو كل العملاء المطابقين للبحث الحالي."
              action={(
                <div className="grid w-full min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <div className="relative md:col-span-2">
                    <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                    <Input className="pr-9" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="بحث في العملاء" />
                  </div>
                  <Select value={projectNameFilter} onChange={(event) => setProjectNameFilter(event.target.value)}>
                    <option value="">كل الجهات</option>
                    {projectNameOptions.map((projectName) => <option key={projectName} value={projectName}>{projectName}</option>)}
                  </Select>
                  <Select value={assignmentStatusFilter} onChange={(event) => setAssignmentStatusFilter(event.target.value as "assigned" | "unassigned" | "")}>
                    <option value="">كل الإسناد</option>
                    <option value="assigned">مسند</option>
                    <option value="unassigned">غير مسند</option>
                  </Select>
                  <Select value={invoiceStatusFilter} onChange={(event) => setInvoiceStatusFilter(event.target.value as InvoiceStatus | "")}>
                    <option value="">كل الفواتير</option>
                    {invoiceStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                  <Select value={collectionStatusFilter} onChange={(event) => setCollectionStatusFilter(event.target.value as CollectionStatus | "")}>
                    <option value="">كل التحصيل</option>
                    {collectionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                </div>
              )}
            />
            <CardBody className="border-b border-surface-200">
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-sm font-black text-ink-900">
                  {selectAllIcon}
                  تحديد الصفحة الحالية
                </span>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="h-4 w-4 rounded border-surface-200 text-mint-700 focus:ring-mint-700"
                  checked={isCurrentPageChecked}
                  onChange={toggleCurrentPage}
                  disabled={!visibleIds.length}
                />
                <span className="text-xs font-bold text-ink-500">{checkedVisibleCount} / {visibleIds.length} في الصفحة</span>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={selectAllSearchResults} disabled={!totalMatchingCustomers}>
                  تحديد كل نتائج البحث
                </Button>
                <Button type="button" variant="secondary" onClick={clearCustomerSelection} disabled={!estimatedSelectedCustomers}>
                  إلغاء تحديد الكل
                </Button>
                <Badge tone={estimatedSelectedCustomers ? "green" : "neutral"}>{estimatedSelectedCustomers} عميل محدد</Badge>
              </div>
              {selectAllMatching ? (
                <p className="mt-2 rounded-xl bg-mint-50 px-3 py-2 text-xs font-bold text-mint-700">
                  تم تحديد كل نتائج البحث الحالية. يمكنك إلغاء تحديد عملاء من الصفحة، وسيتم إرسال الاستثناءات فقط إلى backend.
                </p>
              ) : null}
            </CardBody>
            {customersQuery.isLoading && !customersQuery.data ? <LoadingState /> : null}
            {customersQuery.error ? <ErrorState error={customersQuery.error} /> : null}
            {visibleCustomers.length === 0 && !customersQuery.isLoading ? <EmptyState title="لا يوجد عملاء" description="لا يمكن تجهيز حملة بدون عملاء مستهدفين." /> : null}
            {visibleCustomers.length ? (
              <div className="divide-y divide-surface-200">
                {visibleCustomers.map((customer) => {
                  const checked = selectAllMatching ? !excludedIds.includes(customer.id) : selectedIds.includes(customer.id);
                  const name = customer.fullName || customer.name || customer.whatsappProfileName || customer.phone;
                  const blocked = !customerCanReceiveCampaign(customer) || !hasValidCampaignPhone(customer);

                  return (
                    <label key={customer.id} className={`flex items-center gap-3 px-5 py-4 transition ${checked ? "bg-mint-50/35" : "cursor-pointer hover:bg-mint-50/45"}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-surface-200 text-mint-700 focus:ring-mint-700"
                        checked={checked}
                        disabled={!canSendCampaign}
                        onChange={() => toggleCustomer(customer.id)}
                      />
                      <Avatar name={name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-ink-900">{name}</p>
                        <p className="text-sm text-ink-500">{customer.primaryPhone || customer.phone}</p>
                      </div>
                      {blocked ? <Badge tone="red" className="gap-1"><Ban className="h-3.5 w-3.5" />{customerCampaignBlockReason(customer)}</Badge> : null}
                      {checked ? <CheckCircle2 className="h-5 w-5 text-mint-700" /> : null}
                      {customer.assignedTo ? <Badge>{customer.assignedTo.name}</Badge> : <Badge tone="amber">غير مسند</Badge>}
                    </label>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-200 bg-surface-50 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-600">
                    <span>عرض</span>
                    <Select
                      className="w-24"
                      value={String(customerPageSize)}
                      aria-label="عدد العملاء"
                      onChange={(event) => setCustomerPageSize(Number(event.target.value))}
                    >
                      {customerPageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
                    </Select>
                    <span>عميل</span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black shadow-sm">{totalMatchingCustomers} مطابق</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" disabled={customerPage <= 1 || customersQuery.isFetching} onClick={() => setCustomerPage((current) => Math.max(current - 1, 1))}>
                      السابق
                    </Button>
                    <span className="rounded-xl bg-white px-3 py-2 text-sm font-black text-ink-800 shadow-sm">
                      {customerPage} / {totalCustomerPages}
                    </span>
                    <Button type="button" variant="secondary" disabled={customerPage >= totalCustomerPages || customersQuery.isFetching} onClick={() => setCustomerPage((current) => Math.min(current + 1, totalCustomerPages))}>
                      التالي
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="معاينة أول 3 عملاء" description="القيم المعروضة هنا محلولة من بيانات كل عميل، ولا يرسل المتصفح قيم المتغيرات." />
            <CardBody className="space-y-3">
              {previewLoading ? <LoadingState label="جاري تجهيز المعاينة..." /> : null}
              {previewError ? <ErrorState error={previewError} /> : null}
              {!previewLoading && !previewError && !preview ? (
                <EmptyState title="لا توجد معاينة" description="اختر قالبًا وعملاء لعرض المعاينة." />
              ) : null}
              {preview?.previews.map((item) => (
                <div key={item.customerId} className="rounded-2xl border border-surface-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-ink-900">{item.customerName}</p>
                      <p className="text-xs font-bold text-ink-500">{item.phone}</p>
                    </div>
                    <Badge tone={item.eligible ? "green" : "amber"}>{item.eligible ? "مؤهل" : "بحاجة لمراجعة"}</Badge>
                  </div>
                  {item.warnings.length ? (
                    <div className="mt-3 space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                      {item.warnings.map((warning) => (
                        <p key={warning} className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{warning}</p>
                      ))}
                    </div>
                  ) : null}
                  {item.resolvedVariables.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {item.resolvedVariables.map((variable) => (
                        <div key={variable.variableKey} className="rounded-xl bg-surface-50 px-3 py-2 text-xs">
                          <p className="font-black text-ink-700">{variable.token} - {variable.fieldKey}</p>
                          <p className="mt-1 break-words text-ink-500">{variable.value || "غير متوفر"}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 rounded-2xl rounded-tr-sm bg-[#efeae2] px-4 py-3 text-sm leading-7 text-ink-900">
                    <p className="whitespace-pre-wrap">{item.renderedTemplate || "لا توجد معاينة نصية"}</p>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
