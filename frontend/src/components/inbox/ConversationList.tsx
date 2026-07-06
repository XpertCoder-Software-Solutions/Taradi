import { Filter, Search } from "lucide-react";
import type { Conversation, ConversationStatus } from "../../types/api";
import { cn } from "../../lib/cn";
import { Input, Select } from "../ui/Field";
import { EmptyState, ErrorState, LoadingState } from "../ui/States";
import { ConversationItem } from "./ConversationItem";

export function ConversationList({
  conversations,
  selectedCustomerId,
  search,
  statusFilter,
  unreadOnly,
  unassignedOnly,
  isAdmin,
  isLoading,
  error,
  onSearchChange,
  onStatusChange,
  onUnreadOnlyChange,
  onUnassignedOnlyChange,
  onSelect
}: {
  conversations: Conversation[];
  selectedCustomerId: string | null;
  search: string;
  statusFilter: ConversationStatus | "";
  unreadOnly: boolean;
  unassignedOnly: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  error: unknown;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: ConversationStatus | "") => void;
  onUnreadOnlyChange: (value: boolean) => void;
  onUnassignedOnlyChange: (value: boolean) => void;
  onSelect: (conversation: Conversation) => void;
}) {
  return (
    <section className="flex min-h-0 overflow-hidden rounded-3xl border border-white/75 bg-white/95 shadow-panel backdrop-blur">
      <div className="flex min-h-0 w-full flex-col">
        <div className="border-b border-surface-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-ink-900">المحادثات</h2>
              <p className="mt-1 text-xs text-ink-500">{conversations.length} محادثة في العرض الحالي</p>
            </div>
            <Filter className="h-5 w-5 text-ink-500" />
          </div>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input
              className="rounded-full bg-surface-50 pr-9"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="بحث أو بدء محادثة جديدة"
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Select value={statusFilter} onChange={(event) => onStatusChange(event.target.value as ConversationStatus | "")}>
              <option value="">كل الحالات</option>
              <option value="OPEN">مفتوحة</option>
              <option value="PENDING">قيد المتابعة</option>
              <option value="CLOSED">مغلقة</option>
            </Select>
            <label className="flex h-11 items-center gap-2 rounded-xl border border-surface-200 bg-white px-3 text-sm font-medium text-ink-700">
              <input type="checkbox" checked={unreadOnly} onChange={(event) => onUnreadOnlyChange(event.target.checked)} />
              غير المقروءة
            </label>
            {isAdmin ? (
              <label className="col-span-2 flex h-11 items-center gap-2 rounded-xl border border-surface-200 bg-white px-3 text-sm font-medium text-ink-700">
                <input type="checkbox" checked={unassignedOnly} onChange={(event) => onUnassignedOnlyChange(event.target.checked)} />
                غير المسندة فقط
              </label>
            ) : null}
          </div>
        </div>

        <div className={cn("min-h-0 flex-1 overflow-auto", isLoading && "grid place-items-center")}>
          {isLoading ? <LoadingState label="جاري تحميل المحادثات..." /> : null}
          {error ? <ErrorState error={error} /> : null}
          {!isLoading && !error && conversations.length === 0 ? <EmptyState title="لا توجد محادثات حتى الآن" /> : null}
          {!isLoading && !error ? conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              selected={selectedCustomerId === conversation.customerId}
              onSelect={() => onSelect(conversation)}
            />
          )) : null}
        </div>
      </div>
    </section>
  );
}
