import { useQuery } from "@tanstack/react-query";
import { Bell, Radio } from "lucide-react";
import { getUnreadSummary } from "../api/notifications.api";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/States";
import { useToast } from "../contexts/ToastContext";
import { formatDateTime } from "../lib/format";

export function NotificationsPage() {
  const { toasts } = useToast();
  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: getUnreadSummary
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="الإشعارات"
        description="تنبيهات الرسائل الواردة وملخص المحادثات غير المقروءة أثناء العمل."
        meta={<Badge tone={unreadQuery.data?.unreadTotal ? "red" : "green"}>{unreadQuery.data?.unreadTotal || 0} غير مقروءة</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader title="المحادثات غير المقروءة" description={`${unreadQuery.data?.unreadTotal || 0} رسالة غير مقروءة`} />
          {unreadQuery.isLoading ? <LoadingState /> : null}
          {unreadQuery.error ? <ErrorState error={unreadQuery.error} /> : null}
          {unreadQuery.data?.conversations.length === 0 ? <EmptyState title="لا توجد محادثات غير مقروءة" description="كل شيء واضح الآن." /> : null}
          <div className="divide-y divide-surface-200">
            {unreadQuery.data?.conversations.map((conversation) => {
              const name = conversation.customer?.name || conversation.customer?.phone || "عميل غير معروف";

              return (
                <div key={conversation.id} className="flex items-center justify-between gap-3 px-5 py-4 transition hover:bg-mint-50/45">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={name} />
                    <div className="min-w-0">
                      <p className="truncate font-bold text-ink-900">{name}</p>
                      <p className="text-sm text-ink-500">{conversation.customer?.phone}</p>
                    </div>
                  </div>
                  <Badge tone="red">{conversation.unreadCount}</Badge>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="النشاط الفوري" description="الإشعارات التي وصلت أثناء فتح لوحة التحكم." />
          {toasts.length === 0 ? <EmptyState title="لا توجد إشعارات فورية حتى الآن" description="عند وصول رسالة أو تحديث مباشر سيظهر هنا." /> : null}
          <div className="divide-y divide-surface-200">
            {toasts.map((toast) => (
              <div key={toast.id} className="flex items-start gap-3 px-5 py-4 transition hover:bg-mint-50/45">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-mint-50 text-mint-800">
                  {toast.tone === "success" ? <Radio className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink-900">{toast.title}</p>
                  {toast.description ? <p className="mt-1 text-sm leading-6 text-ink-500">{toast.description}</p> : null}
                  <p className="mt-1 text-xs font-medium text-ink-500">{formatDateTime(toast.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
