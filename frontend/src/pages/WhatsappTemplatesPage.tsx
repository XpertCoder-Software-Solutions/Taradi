import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { listWhatsappTemplates, syncWhatsappTemplates } from "../api/templates.api";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input, Select } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/States";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { translateApiError } from "../lib/i18n";
import type { WhatsappTemplate } from "../types/api";

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
  DISABLED: "neutral"
};

function formatLastSync(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function templateVariables(template: WhatsappTemplate) {
  return [...new Set((template.variables || []).map((variable) => `{{${variable.index}}}`))].sort();
}

function categoryLabel(category?: string | null) {
  return category || "بدون تصنيف";
}

export function WhatsappTemplatesPage() {
  const { user } = useAuth();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const canSync = user?.role === "ADMIN";

  const templatesQuery = useQuery({
    queryKey: ["whatsapp-templates", { search, status, category, language }],
    queryFn: () => listWhatsappTemplates({
      status,
      ...(search ? { search } : {}),
      ...(category ? { category } : {}),
      ...(language ? { language } : {})
    })
  });

  const templates = templatesQuery.data?.items || [];
  const categories = useMemo(() => [...new Set(templates.map((template) => template.category).filter(Boolean) as string[])].sort(), [templates]);
  const languages = useMemo(() => [...new Set(templates.map((template) => template.language))].sort(), [templates]);
  const approvedCount = templates.filter((template) => template.status === "APPROVED").length;

  const syncMutation = useMutation({
    mutationFn: syncWhatsappTemplates,
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      pushToast({
        title: "تمت مزامنة قوالب واتساب",
        description: `تم جلب ${summary.fetched} قالب عبر ${summary.pages} صفحة، إنشاء ${summary.created}، تحديث ${summary.updated}.`,
        tone: "success"
      });
    },
    onError: (error) => pushToast({ title: "تعذرت مزامنة القوالب", description: translateApiError(error), tone: "error" })
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="قوالب واتساب"
        description="كل القوالب المزامنة من Meta تظهر هنا، والإرسال يبقى مقتصرًا على القوالب المعتمدة."
        action={canSync ? (
          <Button
            icon={<RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />}
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            مزامنة من Meta
          </Button>
        ) : null}
        meta={<Badge tone="green">{approvedCount} قالب معتمد</Badge>}
      />

      <Card>
        <CardHeader title="قائمة القوالب" description="يمكن البحث والتصفية حسب الحالة والتصنيف واللغة." />
        <CardBody className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_170px_170px_150px]">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <Input className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو النص" />
            </div>
            <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="الحالة">
              <option value="ALL">كل الحالات</option>
              <option value="APPROVED">معتمد</option>
              <option value="PENDING">قيد المراجعة</option>
              <option value="REJECTED">مرفوض</option>
              <option value="PAUSED">متوقف مؤقتًا</option>
              <option value="DISABLED">معطل</option>
              <option value="IN_APPEAL">قيد الاعتراض</option>
              <option value="PENDING_DELETION">قيد الحذف</option>
            </Select>
            <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="التصنيف">
              <option value="">كل التصنيفات</option>
              {categories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
            </Select>
            <Select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="اللغة">
              <option value="">كل اللغات</option>
              {languages.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </div>

          {templatesQuery.isLoading ? <LoadingState label="جاري تحميل القوالب..." /> : null}
          {templatesQuery.error ? <ErrorState error={templatesQuery.error} /> : null}
          {!templatesQuery.isLoading && !templatesQuery.error && templates.length === 0 ? (
            <EmptyState title="لا توجد قوالب" description={canSync ? "لم تُرجع Meta أي قوالب لهذا الحساب أو لا توجد نتائج تطابق التصفية الحالية." : "لا توجد قوالب متاحة حاليًا."} />
          ) : null}

          {templates.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-surface-200">
              <div className="hidden grid-cols-[minmax(220px,1.4fr)_150px_120px_120px_150px_170px] gap-3 border-b border-surface-200 bg-surface-50 px-4 py-3 text-xs font-black text-ink-500 lg:grid">
                <span>الاسم</span>
                <span>التصنيف</span>
                <span>اللغة</span>
                <span>الحالة</span>
                <span>المتغيرات</span>
                <span>آخر مزامنة</span>
              </div>
              <div className="divide-y divide-surface-200">
                {templates.map((template) => {
                  const variables = templateVariables(template);

                  return (
                    <div key={template.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[minmax(220px,1.4fr)_150px_120px_120px_150px_170px] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-mint-700" />
                          <p className="truncate font-black text-ink-900" dir="ltr">{template.name}</p>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">{template.body || template.headerText || "قالب بدون نص"}</p>
                      </div>
                      <div className="font-bold text-ink-700">{categoryLabel(template.category)}</div>
                      <div className="font-semibold text-ink-500" dir="ltr">{template.language}</div>
                      <div>
                        <Badge tone={statusTone[template.status] || "neutral"}>{statusLabel[template.status] || template.status}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {variables.length > 0 ? variables.map((variable) => (
                          <Badge key={variable} tone="blue" className="font-mono"><span dir="ltr">{variable}</span></Badge>
                        )) : <span className="text-xs font-semibold text-ink-400">بدون متغيرات</span>}
                      </div>
                      <div className="text-xs font-semibold text-ink-500">{formatLastSync(template.lastSyncedAt || template.updatedAt)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
