import { Lock, MessageCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Conversation, ConversationPriority, ConversationStatus, Message } from "../../types/api";
import { EmptyState, ErrorState, LoadingState } from "../ui/States";
import { ChatHeader } from "./ChatHeader";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";

export function ChatWindow({
  conversation,
  messages,
  isAdmin,
  loadingMessages,
  messagesError,
  text,
  mediaType,
  caption,
  file,
  sendingText,
  sendingMedia,
  statusPending,
  priorityPending,
  canSendMessage,
  canSendMedia,
  canChangeStatus,
  canCloseConversation,
  canChangePriority,
  onTextChange,
  onMediaTypeChange,
  onCaptionChange,
  onFileChange,
  onClearFile,
  onSendText,
  onSendMedia,
  onStatusChange,
  onPriorityChange,
  onRefresh
}: {
  conversation: Conversation | null;
  messages: Message[];
  isAdmin: boolean;
  loadingMessages: boolean;
  messagesError: unknown;
  text: string;
  mediaType: "image" | "audio" | "voice" | "document";
  caption: string;
  file: File | null;
  sendingText: boolean;
  sendingMedia: boolean;
  statusPending: boolean;
  priorityPending: boolean;
  canSendMessage: boolean;
  canSendMedia: boolean;
  canChangeStatus: boolean;
  canCloseConversation: boolean;
  canChangePriority: boolean;
  onTextChange: (value: string) => void;
  onMediaTypeChange: (value: "image" | "audio" | "voice" | "document") => void;
  onCaptionChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  onClearFile: () => void;
  onSendText: () => void;
  onSendMedia: () => void;
  onStatusChange: (status: ConversationStatus) => void;
  onPriorityChange: (priority: ConversationPriority) => void;
  onRefresh: () => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const contactBlocked = Boolean(conversation?.customer?.contactBlocked);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, conversation?.customerId]);

  if (!conversation) {
    return (
      <section className="grid min-h-0 place-items-center overflow-hidden rounded-3xl border border-white/75 bg-white/80 shadow-panel backdrop-blur">
        <div className="max-w-sm px-8 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-mint-100 text-mint-800 shadow-sm">
            <MessageCircle className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-lg font-black text-ink-900">اختر محادثة لعرض الرسائل</h2>
          <p className="mt-2 text-sm text-ink-500">ستظهر الرسائل الواردة والصادرة هنا بنفس ترتيب محادثات واتساب.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/75 bg-white shadow-panel">
      <ChatHeader
        conversation={conversation}
        isAdmin={isAdmin}
        statusPending={statusPending}
        priorityPending={priorityPending}
        canChangeStatus={canChangeStatus}
        canCloseConversation={canCloseConversation}
        canChangePriority={canChangePriority}
        onStatusChange={onStatusChange}
        onPriorityChange={onPriorityChange}
        onRefresh={onRefresh}
      />

      <div className="whatsapp-chat-bg min-h-0 flex-1 overflow-auto px-4 py-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-2">
          {loadingMessages ? <LoadingState label="جاري تحميل الرسائل..." /> : null}
          {messagesError ? <ErrorState error={messagesError} /> : null}
          {!loadingMessages && !messagesError && messages.length === 0 ? <EmptyState title="لا توجد رسائل في هذه المحادثة" /> : null}
          {!loadingMessages && !messagesError ? messages.map((message) => <MessageBubble key={message.id} message={message} />) : null}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {contactBlocked ? (
        <footer className="border-t border-red-100 bg-red-50 px-4 py-4">
          <div className="mx-auto flex max-w-5xl items-center gap-3 rounded-2xl border border-red-100 bg-white px-4 py-3 text-sm font-black text-red-800 shadow-sm">
            <Lock className="h-5 w-5 shrink-0" />
            <span>تم إيقاف التواصل مع هذا العميل بسبب حالة التحصيل.</span>
          </div>
        </footer>
      ) : canSendMessage || canSendMedia ? (
        <MessageComposer
          text={text}
          mediaType={mediaType}
          caption={caption}
          file={file}
          sendingText={sendingText}
          sendingMedia={sendingMedia}
          canSendMessage={canSendMessage}
          canSendMedia={canSendMedia}
          onTextChange={onTextChange}
          onMediaTypeChange={onMediaTypeChange}
          onCaptionChange={onCaptionChange}
          onFileChange={onFileChange}
          onClearFile={onClearFile}
          onSendText={onSendText}
          onSendMedia={onSendMedia}
        />
      ) : null}
    </section>
  );
}
