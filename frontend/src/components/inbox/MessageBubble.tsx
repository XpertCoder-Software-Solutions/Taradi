import { FileText, ImageIcon, Music, Paperclip, Volume2 } from "lucide-react";
import { absoluteMediaUrl } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatArabicFileSize, formatChatTime, messageStatusLabel, messageTypeLabel } from "../../lib/i18n";
import type { Message, MessageType } from "../../types/api";

function MediaIcon({ type }: { type: MessageType }) {
  if (type === "IMAGE") return <ImageIcon className="h-4 w-4" />;
  if (type === "DOCUMENT") return <FileText className="h-4 w-4" />;
  if (type === "VOICE") return <Volume2 className="h-4 w-4" />;
  if (type === "AUDIO") return <Music className="h-4 w-4" />;
  return <Paperclip className="h-4 w-4" />;
}

export function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === "OUTBOUND";
  const mediaUrl = absoluteMediaUrl(message.mediaUrl);
  const failed = message.status === "FAILED";

  return (
    <div className={cn("flex", isOutbound ? "justify-start" : "justify-end")}>
      <div className={cn(
        "max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm md:max-w-[68%]",
        isOutbound ? "rounded-tr-sm bg-mint-100 text-ink-900" : "rounded-tl-sm bg-white text-ink-900",
        failed && "border border-red-200 bg-red-50"
      )}>
        {message.type === "IMAGE" ? (
          <div className="space-y-2">
            {mediaUrl ? (
              <img src={mediaUrl} alt={message.caption || message.fileName || "صورة واتساب"} className="max-h-72 rounded-md object-contain" />
            ) : (
              <div className="flex items-center gap-2 rounded-md bg-black/5 px-3 py-2"><ImageIcon className="h-4 w-4" /> صورة</div>
            )}
            {message.caption || message.body ? <p className="whitespace-pre-wrap leading-6">{message.caption || message.body}</p> : null}
          </div>
        ) : null}

        {message.type === "AUDIO" || message.type === "VOICE" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MediaIcon type={message.type} />
              <span>{message.type === "VOICE" ? "رسالة صوتية" : "مقطع صوتي"}</span>
            </div>
            {mediaUrl ? <audio src={mediaUrl} controls className="w-64 max-w-full" /> : null}
          </div>
        ) : null}

        {message.type === "DOCUMENT" ? (
          <div className="min-w-60 space-y-2">
            <div className="flex items-center gap-2 rounded-md bg-black/5 p-3">
              <FileText className="h-5 w-5 text-ink-500" />
              <div className="min-w-0">
                <p className="truncate font-medium">{message.fileName || "ملف"}</p>
                <p className="text-xs text-ink-500">{message.mimeType || "ملف"} · {formatArabicFileSize(message.fileSize)}</p>
              </div>
            </div>
            {message.caption || message.body ? <p className="whitespace-pre-wrap leading-6">{message.caption || message.body}</p> : null}
            {mediaUrl ? (
              <a className="inline-flex rounded-md bg-white px-3 py-1.5 text-xs font-medium text-[#116d4d]" href={mediaUrl} target="_blank" rel="noreferrer">
                فتح الملف
              </a>
            ) : null}
          </div>
        ) : null}

        {["TEXT", "TEMPLATE", "SYSTEM", "UNKNOWN", "VIDEO", "STICKER", "INTERACTIVE"].includes(message.type) ? (
          <p className="whitespace-pre-wrap leading-6">{message.body || message.content || message.caption || message.fileName || message.templateName || messageTypeLabel[message.type]}</p>
        ) : null}

        <div className={cn("mt-1 flex items-center justify-end gap-2 text-[11px]", failed ? "text-red-700" : "text-ink-500")}>
          <span>{formatChatTime(message.createdAt)}</span>
          {isOutbound ? <span>{messageStatusLabel[message.status]}</span> : null}
        </div>
      </div>
    </div>
  );
}
