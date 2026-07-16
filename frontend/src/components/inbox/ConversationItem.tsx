import { UserRoundCheck } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatChatTime, messageTypeLabel } from "../../lib/i18n";
import type { Conversation, Message } from "../../types/api";
import { Avatar } from "../ui/Avatar";
import { ArabicBadge } from "./ArabicBadge";

const mediaPlaceholderPattern = /^\[(image|video|audio|voice|document|sticker)\]$/i;

function firstPreviewText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || "").trim();

    if (text && !mediaPlaceholderPattern.test(text)) {
      return text;
    }
  }

  return null;
}

function mediaPreview(message: Message) {
  if (message.type === "IMAGE") return "صورة";
  if (message.type === "VIDEO") return "فيديو";
  if (message.type === "AUDIO" || message.type === "VOICE") return "رسالة صوتية";
  if (message.type === "STICKER") return "ملصق";
  if (message.type === "DOCUMENT") {
    const fileName = message.fileName || "";
    return message.mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")
      ? "ملف PDF"
      : "مستند";
  }

  return messageTypeLabel[message.type] || "رسالة غير مدعومة";
}

function messagePreview(message: Message | null) {
  if (!message) {
    return "لا توجد رسائل حتى الآن";
  }

  return firstPreviewText(message.caption, message.body, message.content, message.templateName) || mediaPreview(message);
}

export function ConversationItem({ conversation, selected, onSelect }: {
  conversation: Conversation;
  selected: boolean;
  onSelect: () => void;
}) {
  const customerName = conversation.customer?.name || conversation.customer?.phone || "عميل غير معروف";
  const lastMessageAt = conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-3 border-b border-surface-200 px-4 py-3 text-right transition hover:bg-mint-50/55",
        selected && "bg-mint-100/70 hover:bg-mint-100"
      )}
    >
      <Avatar name={conversation.customer?.name || conversation.customer?.phone} className="rounded-full" />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-900">{customerName}</p>
            <p className="truncate text-xs text-ink-500">{conversation.customer?.phone || "بدون رقم"}</p>
          </div>
          <span className="shrink-0 text-[11px] text-ink-500">{formatChatTime(lastMessageAt)}</span>
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="line-clamp-1 min-w-0 flex-1 text-sm text-ink-700">{messagePreview(conversation.lastMessage)}</p>
          {conversation.unreadCount > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#25d366] px-1.5 text-[11px] font-bold text-white">
              {conversation.unreadCount}
            </span>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {conversation.assignedEmployee ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-500">
              <UserRoundCheck className="h-3.5 w-3.5" />
              {conversation.assignedEmployee.name}
            </span>
          ) : (
            <ArabicBadge tone="amber" className="py-0.5 text-[11px]">غير مسندة</ArabicBadge>
          )}
          {conversation.status === "CLOSED" ? <ArabicBadge className="py-0.5 text-[11px]">مغلقة</ArabicBadge> : null}
          {conversation.priority === "URGENT" || conversation.priority === "HIGH" ? (
            <ArabicBadge tone={conversation.priority === "URGENT" ? "red" : "amber"} className="py-0.5 text-[11px]">
              {conversation.priority === "URGENT" ? "عاجلة" : "مرتفعة"}
            </ArabicBadge>
          ) : null}
        </div>
      </div>
    </button>
  );
}
