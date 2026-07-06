import { RefreshCw, UserRoundCheck } from "lucide-react";
import type { Conversation, ConversationPriority, ConversationStatus } from "../../types/api";
import { priorityLabel, statusLabel } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Select } from "../ui/Field";
import { Avatar } from "../ui/Avatar";
import { PriorityBadge } from "./PriorityBadge";
import { StatusBadge } from "./StatusBadge";

export function ChatHeader({
  conversation,
  isAdmin,
  statusPending,
  priorityPending,
  canChangeStatus,
  canCloseConversation,
  canChangePriority,
  onStatusChange,
  onPriorityChange,
  onRefresh
}: {
  conversation: Conversation;
  isAdmin: boolean;
  statusPending: boolean;
  priorityPending: boolean;
  canChangeStatus: boolean;
  canCloseConversation: boolean;
  canChangePriority: boolean;
  onStatusChange: (status: ConversationStatus) => void;
  onPriorityChange: (priority: ConversationPriority) => void;
  onRefresh: () => void;
}) {
  const customerName = conversation.customer?.name || conversation.customer?.phone || "عميل غير معروف";

  return (
    <header className="flex min-h-[92px] flex-col gap-3 border-b border-surface-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={conversation.customer?.name || conversation.customer?.phone} className="rounded-full" />
        <div className="min-w-0">
          <h2 className="truncate text-base font-black text-ink-900">{customerName}</h2>
          <p className="truncate text-sm text-ink-500">{conversation.customer?.phone || "بدون رقم"}</p>
          {isAdmin ? (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-500">
              <UserRoundCheck className="h-3.5 w-3.5" />
              {conversation.assignedEmployee?.name || "غير مسندة"}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={conversation.status} />
        <PriorityBadge priority={conversation.priority} />
        {canChangeStatus || canCloseConversation ? (
          <Select
            aria-label="تغيير الحالة"
            className="h-9 w-36 bg-white"
            value={conversation.status}
            onChange={(event) => onStatusChange(event.target.value as ConversationStatus)}
            disabled={statusPending}
          >
            {Object.entries(statusLabel)
              .filter(([status]) => status !== "CLOSED" || canCloseConversation || conversation.status === "CLOSED")
              .map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </Select>
        ) : null}
        {canChangePriority ? (
          <Select
            aria-label="تغيير الأولوية"
            className="h-9 w-36 bg-white"
            value={conversation.priority}
            onChange={(event) => onPriorityChange(event.target.value as ConversationPriority)}
            disabled={priorityPending}
          >
            {Object.entries(priorityLabel).map(([priority, label]) => <option key={priority} value={priority}>{label}</option>)}
          </Select>
        ) : null}
        <Button type="button" variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
          تحديث
        </Button>
      </div>
    </header>
  );
}
