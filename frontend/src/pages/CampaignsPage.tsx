import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, Search, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createBulkCampaign, type CampaignResponse } from "../api/campaigns.api";
import { listCustomers } from "../api/customers.api";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { FieldShell, Input, Textarea } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/States";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { translateApiError } from "../lib/i18n";
import type { Customer } from "../types/api";

const campaignSchema = z.object({
  templateName: z.string().trim().min(1, "اسم القالب مطلوب"),
  languageCode: z.string().trim().min(2, "رمز اللغة مطلوب"),
  componentsJson: z.string().optional()
});

type CampaignValues = z.infer<typeof campaignSchema>;

function customerCanReceiveCampaign(customer: Customer) {
  return !customer.contactBlocked;
}

function customerCampaignBlockReason(customer: Customer) {
  if (customer.contactBlocked) {
    return customer.collectionStatusLabel || "ممنوع التواصل";
  }

  return "غير مؤهل للإرسال";
}

export function CampaignsPage() {
  const { hasPermission } = useAuth();
  const canSendCampaign = hasPermission("campaigns.send");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<CampaignResponse | null>(null);
  const { pushToast } = useToast();

  const customersQuery = useQuery({
    queryKey: ["customers", "campaigns", { search }],
    queryFn: () => listCustomers({ search, limit: 100 })
  });

  const form = useForm<CampaignValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      templateName: "",
      languageCode: "ar",
      componentsJson: "[]"
    }
  });

  const selectedCustomers = useMemo(
    () => customersQuery.data?.items.filter((customer) => selectedIds.includes(customer.id)) || [],
    [customersQuery.data?.items, selectedIds]
  );
  const visibleCustomers = customersQuery.data?.items || [];
  const blockedVisibleCustomers = visibleCustomers.filter((customer) => !customerCanReceiveCampaign(customer));
  const eligibleSelectedCustomers = selectedCustomers.filter((customer) => customerCanReceiveCampaign(customer));

  const campaignMutation = useMutation({
    mutationFn: async (values: CampaignValues) => {
      let components: unknown[] = [];

      if (values.componentsJson?.trim()) {
        const parsed = JSON.parse(values.componentsJson);
        if (!Array.isArray(parsed)) {
          throw new Error("مكونات المتغيرات يجب أن تكون مصفوفة");
        }
        components = parsed;
      }

      return createBulkCampaign({
        customerIds: selectedIds,
        templateName: values.templateName,
        languageCode: values.languageCode,
        components
      });
    },
    onSuccess: (result) => {
      setLastResult(result);
      pushToast({
        title: result.excludedBlockedCustomers ? "تم استبعاد العملاء المسددين من الحملة" : "تم تجهيز الحملة",
        description: `${result.queued} في قائمة الإرسال، ${result.failed} فشل${result.excludedBlockedCustomers ? `، ${result.excludedBlockedCustomers} مستبعد` : ""}`,
        tone: result.failed || result.excludedBlockedCustomers ? "info" : "success"
      });
    },
    onError: (error) => pushToast({ title: "تعذر تجهيز الحملة", description: translateApiError(error), tone: "error" })
  });

  function toggleCustomer(id: string) {
    const customer = customersQuery.data?.items.find((item) => item.id === id);

    if (customer && !customerCanReceiveCampaign(customer)) {
      pushToast({
        title: "لا يمكن اختيار هذا العميل",
        description: customerCampaignBlockReason(customer),
        tone: "info"
      });
      return;
    }

    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="الحملات الجماعية"
        description="جهّز حملات واتساب باستخدام القوالب المعتمدة واختر العملاء المستهدفين بدقة."
        action={<Badge tone="green">{eligibleSelectedCustomers.length} مستلم مؤهل</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="تفاصيل الحملة" description="استخدم اسم القالب ورمز اللغة كما هما في منصة واتساب." />
            <CardBody>
              <form className="space-y-4" onSubmit={form.handleSubmit((values) => campaignMutation.mutate(values))}>
                <FieldShell label="اسم القالب" error={form.formState.errors.templateName?.message}>
                  <Input {...form.register("templateName")} placeholder="اسم القالب المعتمد" />
                </FieldShell>
                <FieldShell label="رمز اللغة" error={form.formState.errors.languageCode?.message}>
                  <Input {...form.register("languageCode")} placeholder="مثال: ar" />
                </FieldShell>
                <FieldShell label="مكونات المتغيرات" error={form.formState.errors.componentsJson?.message}>
                  <Textarea className="font-mono text-left" dir="ltr" {...form.register("componentsJson")} />
                </FieldShell>
                <div className="rounded-2xl border border-mint-100 bg-mint-50 px-4 py-3 text-sm font-bold text-mint-800">
                  <div>العملاء المختارون: {selectedCustomers.length}</div>
                  <div>المؤهلون للإرسال: {eligibleSelectedCustomers.length}</div>
                  <div>المستبعدون: {selectedCustomers.length - eligibleSelectedCustomers.length}</div>
                </div>
                {blockedVisibleCustomers.length ? (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
                    يتم استبعاد العملاء الممنوع التواصل معهم تلقائيًا.
                  </div>
                ) : null}
                {canSendCampaign ? (
                  <Button className="w-full" size="lg" type="submit" disabled={campaignMutation.isPending || eligibleSelectedCustomers.length === 0} icon={<Send className="h-4 w-4" />}>
                    تجهيز الحملة
                  </Button>
                ) : null}
              </form>
            </CardBody>
          </Card>

          {lastResult ? (
            <Card>
              <CardHeader title="نتيجة التجهيز" description="ملخص الرسائل التي تم وضعها في قائمة الإرسال." />
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-2xl bg-mint-50 p-4">
                    <p className="text-sm font-bold text-mint-800">في قائمة الإرسال</p>
                    <p className="mt-2 text-3xl font-black text-ink-900">{lastResult.queued}</p>
                  </div>
                  <div className="rounded-2xl bg-red-50 p-4">
                    <p className="text-sm font-bold text-red-700">فشل</p>
                    <p className="mt-2 text-3xl font-black text-ink-900">{lastResult.failed}</p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-4">
                    <p className="text-sm font-bold text-amber-800">مستبعدون</p>
                    <p className="mt-2 text-3xl font-black text-ink-900">{lastResult.excludedBlockedCustomers || 0}</p>
                  </div>
                </div>
                {lastResult.excludedCustomers?.length ? (
                  <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-3">
                    <p className="text-sm font-black text-amber-900">العملاء المستبعدون</p>
                    <div className="mt-2 max-h-36 space-y-2 overflow-auto">
                      {lastResult.excludedCustomers.map((customer) => (
                        <div key={customer.customerId} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs">
                          <span className="truncate font-bold text-ink-800">{customer.fullName}</span>
                          <Badge tone="amber">{customer.reason}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 max-h-56 space-y-2 overflow-auto">
                  {lastResult.results.map((result) => (
                    <div key={`${result.customerId}-${result.messageId || result.error}`} className="flex items-center justify-between gap-3 rounded-xl bg-surface-50 px-3 py-2 text-xs">
                      <span className="truncate text-ink-500">{result.customerId}</span>
                      <Badge tone={result.status === "QUEUED" ? "green" : "red"}>{result.status === "QUEUED" ? "قيد الإرسال" : "فشل"}</Badge>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader
            title="المستلمون"
            description="اختر العملاء المستهدفين بهذه الحملة."
            action={(
              <div className="relative w-full sm:w-80">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                <Input className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث في العملاء" />
              </div>
            )}
          />
          {customersQuery.isLoading ? <LoadingState /> : null}
          {customersQuery.error ? <ErrorState error={customersQuery.error} /> : null}
          {customersQuery.data?.items.length === 0 ? <EmptyState title="لا يوجد عملاء" description="لا يمكن تجهيز حملة بدون عملاء مستهدفين." /> : null}
          {customersQuery.data?.items.length ? (
            <div className="divide-y divide-surface-200">
              {customersQuery.data.items.map((customer) => {
                const checked = selectedIds.includes(customer.id);
                const name = customer.fullName || customer.name || customer.whatsappProfileName || customer.phone;
                const blocked = !customerCanReceiveCampaign(customer);

                return (
                  <label key={customer.id} className={`flex items-center gap-3 px-5 py-4 transition ${blocked ? "cursor-not-allowed bg-surface-50/80 opacity-75" : "cursor-pointer hover:bg-mint-50/45"}`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-surface-200 text-mint-700 focus:ring-mint-700"
                      checked={checked}
                      disabled={!canSendCampaign || blocked}
                      onChange={() => toggleCustomer(customer.id)}
                    />
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-ink-900">{name}</p>
                      <p className="text-sm text-ink-500">{customer.phone}</p>
                    </div>
                    {blocked ? <Badge tone="red" className="gap-1"><Ban className="h-3.5 w-3.5" />{customerCampaignBlockReason(customer)}</Badge> : null}
                    {checked ? <CheckCircle2 className="h-5 w-5 text-mint-700" /> : null}
                    {customer.assignedTo ? <Badge>{customer.assignedTo.name}</Badge> : <Badge tone="amber">غير مسند</Badge>}
                  </label>
                );
              })}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
