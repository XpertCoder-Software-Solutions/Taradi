import { useQuery } from "@tanstack/react-query";
import { Activity, Bell, BriefcaseBusiness, Inbox, Megaphone } from "lucide-react";
import { listChats } from "../api/chats.api";
import { listCustomers } from "../api/customers.api";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/States";
import { StatCard } from "../components/ui/StatCard";
import { useAuth } from "../contexts/AuthContext";
import { formatDateTime } from "../lib/format";
import { messageTypeLabel, priorityLabel } from "../lib/i18n";

export function OverviewPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const chatsQuery = useQuery({
    queryKey: ["chats", "overview"],
    queryFn: () => listChats({ limit: 8 })
  });

  const openChatsQuery = useQuery({
    queryKey: ["chats", "overview", "open"],
    queryFn: () => listChats({ limit: 1, status: "OPEN" })
  });

  const customersQuery = useQuery({
    queryKey: ["customers", "overview"],
    queryFn: () => listCustomers({ limit: 1 })
  });

  const unreadTotal = chatsQuery.data?.items.reduce((sum, item) => sum + item.unreadCount, 0) || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="لوحة التحكم"
        description={isAdmin ? "نظرة تنفيذية على نشاط العملاء والمحادثات والتنبيهات في تراضي." : "ملخص سريع للعملاء والمحادثات المسندة إليك."}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="إجمالي العملاء" value={customersQuery.data?.meta.total ?? "—"} icon={<BriefcaseBusiness className="h-5 w-5" />} />
        <StatCard label="المحادثات المفتوحة" value={openChatsQuery.data?.meta.total ?? "—"} icon={<Inbox className="h-5 w-5" />} />
        <StatCard label="الرسائل غير المقروءة" value={unreadTotal} icon={<Bell className="h-5 w-5" />} />
        <StatCard label="الحملات المرسلة" value="—" icon={<Megaphone className="h-5 w-5" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader title="أحدث المحادثات" description="آخر المحادثات نشاطًا في صندوق الرسائل." />
          {chatsQuery.isLoading ? <LoadingState /> : null}
          {chatsQuery.error ? <ErrorState error={chatsQuery.error} /> : null}
          {chatsQuery.data && chatsQuery.data.items.length === 0 ? (
            <EmptyState title="لا توجد محادثات حتى الآن" description="ستظهر هنا رسائل واتساب الواردة والردود المرسلة." />
          ) : null}
          {chatsQuery.data && chatsQuery.data.items.length > 0 ? (
            <div className="divide-y divide-surface-200">
              {chatsQuery.data.items.map((conversation) => {
                const customerName = conversation.customer?.name || conversation.customer?.whatsappProfileName || conversation.customer?.phone || "عميل غير معروف";

                return (
                  <div key={conversation.id} className="flex flex-col gap-3 px-5 py-4 transition hover:bg-mint-50/45 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={customerName} />
                      <div className="min-w-0">
                        <p className="truncate font-bold text-ink-900">{customerName}</p>
                        <p className="mt-1 truncate text-sm text-ink-500">
                          {conversation.lastMessage?.body || conversation.lastMessage?.content || conversation.lastMessage?.caption || conversation.lastMessage?.fileName || (conversation.lastMessage ? messageTypeLabel[conversation.lastMessage.type] : "لا توجد رسائل حتى الآن")}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {conversation.unreadCount > 0 ? <Badge tone="red">{conversation.unreadCount} غير مقروءة</Badge> : null}
                      <Badge tone={conversation.priority === "HIGH" || conversation.priority === "URGENT" ? "amber" : "neutral"}>{priorityLabel[conversation.priority]}</Badge>
                      <span className="text-xs font-medium text-ink-500">{formatDateTime(conversation.lastMessageAt || conversation.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="النشاط الأخير" description="سيظهر هنا سجل النشاط عند توفر مصدر بيانات مخصص." />
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title="لا توجد أنشطة حديثة"
            description="لا توجد واجهة قراءة مستقلة للنشاط حاليًا، لذلك لا يتم عرض بيانات افتراضية."
          />
        </Card>
      </div>
    </div>
  );
}
