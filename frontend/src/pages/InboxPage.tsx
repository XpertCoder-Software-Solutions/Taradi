import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listChats,
  listMessages,
  markRead,
  sendMediaMessage,
  sendTextMessage,
  updatePriority,
  updateStatus
} from "../api/chats.api";
import { ChatWindow } from "../components/inbox/ChatWindow";
import { ConversationList } from "../components/inbox/ConversationList";
import { RealtimeStatus } from "../components/inbox/RealtimeStatus";
import { PageHeader } from "../components/ui/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { translateApiError } from "../lib/i18n";
import type { Conversation, ConversationPriority, ConversationStatus } from "../types/api";

export function InboxPage() {
  const { user, hasPermission } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const canSendMessage = hasPermission("chats.send_message");
  const canSendMedia = hasPermission("chats.send_media");
  const canMarkRead = hasPermission("chats.mark_read");
  const canChangeStatus = hasPermission("chats.change_status");
  const canCloseConversation = hasPermission("chats.close_conversation");
  const canChangePriority = hasPermission("chats.change_priority");
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(() => searchParams.get("customerId"));
  const [text, setText] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "audio" | "voice" | "document">("image");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const chatsQuery = useQuery({
    queryKey: ["chats", { search, statusFilter, unreadOnly, unassignedOnly }],
    queryFn: () => listChats({
      search,
      limit: 100,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(unreadOnly ? { unreadOnly: true } : {}),
      ...(isAdmin && unassignedOnly ? { unassignedOnly: true } : {})
    })
  });

  const conversations = useMemo(() => {
    return [...(chatsQuery.data?.items || [])].sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : new Date(a.createdAt).getTime();
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : new Date(b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [chatsQuery.data?.items]);

  useEffect(() => {
    if (!selectedCustomerId && conversations[0]) {
      setSelectedCustomerId(conversations[0].customerId);
      setSearchParams((currentParams) => {
        const nextParams = new URLSearchParams(currentParams);
        nextParams.set("customerId", conversations[0].customerId);
        return nextParams;
      }, { replace: true });
    }
  }, [conversations, selectedCustomerId, setSearchParams]);

  useEffect(() => {
    const customerIdFromUrl = searchParams.get("customerId");

    if (customerIdFromUrl && customerIdFromUrl !== selectedCustomerId) {
      setSelectedCustomerId(customerIdFromUrl);
    }
  }, [searchParams, selectedCustomerId]);

  const selectedConversation = useMemo<Conversation | null>(
    () => conversations.find((item) => item.customerId === selectedCustomerId) || null,
    [conversations, selectedCustomerId]
  );

  const messagesQuery = useQuery({
    queryKey: ["messages", selectedCustomerId],
    queryFn: () => listMessages(selectedCustomerId || ""),
    enabled: Boolean(selectedCustomerId)
  });

  const refreshConversation = () => {
    queryClient.invalidateQueries({ queryKey: ["chats"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    if (selectedCustomerId) {
      queryClient.invalidateQueries({ queryKey: ["messages", selectedCustomerId] });
    }
  };

  const markReadMutation = useMutation({
    mutationFn: markRead,
    onSuccess: refreshConversation
  });

  const sendTextMutation = useMutation({
    mutationFn: () => sendTextMessage(selectedCustomerId || "", text),
    onSuccess: () => {
      setText("");
      refreshConversation();
      pushToast({ title: "تم وضع الرسالة في قائمة الإرسال", tone: "success" });
    },
    onError: (error) => pushToast({ title: "تعذر إرسال الرسالة", description: translateApiError(error), tone: "error" })
  });

  const sendMediaMutation = useMutation({
    mutationFn: () => {
      if (!file || !selectedCustomerId) {
        throw new Error("اختر ملفًا أولًا");
      }

      return sendMediaMessage(selectedCustomerId, {
        file,
        type: mediaType,
        caption: caption || undefined
      });
    },
    onSuccess: () => {
      setFile(null);
      setCaption("");
      refreshConversation();
      pushToast({ title: "تم وضع المرفق في قائمة الإرسال", tone: "success" });
    },
    onError: (error) => pushToast({ title: "تعذر إرسال المرفق", description: translateApiError(error), tone: "error" })
  });

  const statusMutation = useMutation({
    mutationFn: (status: ConversationStatus) => updateStatus(selectedCustomerId || "", status),
    onSuccess: refreshConversation,
    onError: (error) => pushToast({ title: "تعذر تغيير الحالة", description: translateApiError(error), tone: "error" })
  });

  const priorityMutation = useMutation({
    mutationFn: (priority: ConversationPriority) => updatePriority(selectedCustomerId || "", priority),
    onSuccess: refreshConversation,
    onError: (error) => pushToast({ title: "تعذر تغيير الأولوية", description: translateApiError(error), tone: "error" })
  });

  function selectConversation(conversation: Conversation) {
    setSelectedCustomerId(conversation.customerId);
    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);
      nextParams.set("customerId", conversation.customerId);
      return nextParams;
    });

    if (conversation.unreadCount > 0 && canMarkRead) {
      markReadMutation.mutate(conversation.customerId);
    }
  }

  return (
    <div className="flex h-[calc(100vh-128px)] min-h-[680px] flex-col gap-4">
      <PageHeader
        title={isAdmin ? "المحادثات" : "محادثاتي"}
        description="إدارة محادثات واتساب والرد على العملاء من مكان واحد."
        action={<RealtimeStatus />}
      />

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[390px_1fr]">
        <ConversationList
          conversations={conversations}
          selectedCustomerId={selectedCustomerId}
          search={search}
          statusFilter={statusFilter}
          unreadOnly={unreadOnly}
          unassignedOnly={unassignedOnly}
          isAdmin={isAdmin}
          isLoading={chatsQuery.isLoading}
          error={chatsQuery.error}
          onSearchChange={setSearch}
          onStatusChange={setStatusFilter}
          onUnreadOnlyChange={setUnreadOnly}
          onUnassignedOnlyChange={setUnassignedOnly}
          onSelect={selectConversation}
        />

        <ChatWindow
          conversation={selectedConversation}
          messages={messagesQuery.data?.items || []}
          isAdmin={isAdmin}
          loadingMessages={messagesQuery.isLoading}
          messagesError={messagesQuery.error}
          text={text}
          mediaType={mediaType}
          caption={caption}
          file={file}
          sendingText={sendTextMutation.isPending}
          sendingMedia={sendMediaMutation.isPending}
          statusPending={statusMutation.isPending}
          priorityPending={priorityMutation.isPending}
          canSendMessage={canSendMessage}
          canSendMedia={canSendMedia}
          canChangeStatus={canChangeStatus}
          canCloseConversation={canCloseConversation}
          canChangePriority={canChangePriority}
          onTextChange={setText}
          onMediaTypeChange={setMediaType}
          onCaptionChange={setCaption}
          onFileChange={setFile}
          onClearFile={() => { setFile(null); setCaption(""); }}
          onSendText={() => sendTextMutation.mutate()}
          onSendMedia={() => sendMediaMutation.mutate()}
          onStatusChange={(status) => statusMutation.mutate(status)}
          onPriorityChange={(priority) => priorityMutation.mutate(priority)}
          onRefresh={refreshConversation}
        />
      </div>
    </div>
  );
}
