import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listChats,
  listMessages,
  markRead,
  quickSendMessage,
  sendMediaMessage,
  sendTextMessage,
  updatePriority,
  updateStatus
} from "../api/chats.api";
import { listEmployees } from "../api/employees.api";
import { sendWhatsappTemplate, type SendWhatsappTemplatePayload } from "../api/templates.api";
import { ChatWindow } from "../components/inbox/ChatWindow";
import { ConversationList } from "../components/inbox/ConversationList";
import { QuickSendModal, type QuickSendPayload } from "../components/inbox/QuickSendModal";
import { RealtimeStatus } from "../components/inbox/RealtimeStatus";
import { TemplateSendModal, type SendTemplateFormPayload } from "../components/inbox/TemplateSendModal";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import { useRealtimeStatus } from "../contexts/SocketProvider";
import { useToast } from "../contexts/ToastContext";
import { translateApiError } from "../lib/i18n";
import { getSocket } from "../lib/socketManager";
import type { Conversation, ConversationPriority, ConversationStatus, User } from "../types/api";

type ComposerMediaType = "image" | "audio" | "voice" | "video" | "document";

function inferComposerMediaType(file: File): ComposerMediaType {
  const mimeType = file.type.toLowerCase();

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  return "document";
}

export function InboxPage() {
  const { user, hasPermission } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const canSendMessage = hasPermission("chats.send_message");
  const canSendMedia = hasPermission("chats.send_media");
  const canSendTemplate = canSendMessage || hasPermission("templates.send");
  const canMarkRead = hasPermission("chats.mark_read");
  const canChangeStatus = hasPermission("chats.change_status");
  const canCloseConversation = hasPermission("chats.close_conversation");
  const canChangePriority = hasPermission("chats.change_priority");
  const { pushToast } = useToast();
  const realtimeStatus = useRealtimeStatus();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(() => searchParams.get("customerId"));
  const [text, setText] = useState("");
  const [mediaType, setMediaType] = useState<ComposerMediaType>("image");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const quickSendOpen = searchParams.get("quickSend") === "1";

  const staffQuery = useQuery({
    queryKey: ["quick-send-assignees", user?.role],
    queryFn: () => listEmployees({ limit: 100, isActive: true }),
    enabled: quickSendOpen && Boolean(user && user.role !== "EMPLOYEE" && hasPermission("employees.view_team"))
  });

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

  useEffect(() => {
    const conversationId = selectedConversation?.id;
    const socket = getSocket();

    if (!conversationId || realtimeStatus !== "connected" || !socket) {
      return undefined;
    }

    socket.emit("conversation:join", { conversationId });

    return () => {
      socket.emit("conversation:leave", { conversationId });
    };
  }, [realtimeStatus, selectedConversation?.id]);

  const quickSendAssignees = useMemo<User[]>(() => {
    if (!user || user.role === "EMPLOYEE") {
      return [];
    }

    const staff = staffQuery.data?.items || [];

    if (user.role === "SUPERVISOR") {
      return [
        user,
        ...staff.filter((item) => item.id !== user.id && item.role === "EMPLOYEE")
      ];
    }

    return staff.filter((item) => item.role === "EMPLOYEE" || item.role === "SUPERVISOR");
  }, [staffQuery.data?.items, user]);

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

  const openQuickSend = () => {
    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);
      nextParams.set("quickSend", "1");
      return nextParams;
    });
  };

  const closeQuickSend = () => {
    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);
      nextParams.delete("quickSend");
      return nextParams;
    });
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

  const sendVoiceMutation = useMutation({
    mutationFn: (voiceFile: File) => {
      if (!selectedCustomerId) {
        throw new Error("اختر محادثة أولًا");
      }

      return sendMediaMessage(selectedCustomerId, {
        file: voiceFile,
        type: "voice"
      });
    },
    onSuccess: () => {
      refreshConversation();
      pushToast({ title: "تم وضع الرسالة الصوتية في قائمة الإرسال", tone: "success" });
    },
    onError: (error) => pushToast({ title: "تعذر إرسال الرسالة الصوتية", description: translateApiError(error), tone: "error" })
  });

  const sendTemplateMutation = useMutation({
    mutationFn: (payload: SendWhatsappTemplatePayload) => sendWhatsappTemplate(payload),
    onSuccess: () => {
      setTemplateModalOpen(false);
      refreshConversation();
      pushToast({ title: "تم إرسال القالب بنجاح", tone: "success" });
    },
    onError: (error) => pushToast({ title: "تعذر إرسال القالب", description: translateApiError(error), tone: "error" })
  });

  const quickSendMutation = useMutation({
    mutationFn: (payload: QuickSendPayload) => quickSendMessage(payload),
    onSuccess: (result) => {
      setSelectedCustomerId(result.conversation.customerId);
      setSearchParams((currentParams) => {
        const nextParams = new URLSearchParams(currentParams);
        nextParams.delete("quickSend");
        nextParams.set("customerId", result.conversation.customerId);
        return nextParams;
      });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["messages", result.conversation.customerId] });
      pushToast({ title: "تم فتح المحادثة ووضع الرسالة في قائمة الإرسال", tone: "info" });
    },
    onError: (error) => pushToast({ title: "تعذر الإرسال السريع", description: translateApiError(error), tone: "error" })
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

  function handleFileChange(nextFile: File | null) {
    setFile(nextFile);

    if (nextFile) {
      setMediaType(inferComposerMediaType(nextFile));
    }
  }

  function sendTemplate(payload: SendTemplateFormPayload) {
    if (!selectedCustomerId) {
      pushToast({ title: "اختر محادثة أولًا", tone: "error" });
      return Promise.reject(new Error("اختر محادثة أولًا"));
    }

    return sendTemplateMutation.mutateAsync({
      customerId: selectedCustomerId,
      ...payload
    }).then(() => undefined);
  }

  return (
    <div className="flex h-[calc(100vh-128px)] min-h-[680px] flex-col gap-4">
      <PageHeader
        title={isAdmin ? "المحادثات" : "محادثاتي"}
        description="إدارة محادثات واتساب والرد على العملاء من مكان واحد."
        action={(
          <>
            {canSendMessage ? (
              <Button variant="secondary" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={openQuickSend}>
                إرسال سريع
              </Button>
            ) : null}
            <RealtimeStatus />
          </>
        )}
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
          sendingVoice={sendVoiceMutation.isPending}
          sendingTemplate={sendTemplateMutation.isPending}
          statusPending={statusMutation.isPending}
          priorityPending={priorityMutation.isPending}
          canSendMessage={canSendMessage}
          canSendMedia={canSendMedia}
          canSendTemplate={canSendTemplate}
          canChangeStatus={canChangeStatus}
          canCloseConversation={canCloseConversation}
          canChangePriority={canChangePriority}
          onTextChange={setText}
          onMediaTypeChange={setMediaType}
          onCaptionChange={setCaption}
          onFileChange={handleFileChange}
          onClearFile={() => { setFile(null); setCaption(""); }}
          onSendText={() => sendTextMutation.mutate()}
          onSendMedia={() => sendMediaMutation.mutate()}
          onSendVoice={(voiceFile) => sendVoiceMutation.mutate(voiceFile)}
          onOpenTemplateModal={() => setTemplateModalOpen(true)}
          onStatusChange={(status) => statusMutation.mutate(status)}
          onPriorityChange={(priority) => priorityMutation.mutate(priority)}
          onRefresh={refreshConversation}
        />
      </div>

      <QuickSendModal
        open={quickSendOpen}
        onClose={closeQuickSend}
        onSubmit={(payload) => quickSendMutation.mutateAsync(payload).then(() => undefined)}
        isSubmitting={quickSendMutation.isPending}
        showAssignee={Boolean(user && user.role !== "EMPLOYEE")}
        assignees={quickSendAssignees}
        assigneesLoading={staffQuery.isLoading}
        emptyAssigneeLabel={user?.role === "ADMIN" ? "بدون إسناد" : "إسناده لي"}
      />

      <TemplateSendModal
        open={templateModalOpen}
        conversation={selectedConversation}
        onClose={() => setTemplateModalOpen(false)}
        onSubmit={sendTemplate}
        isSubmitting={sendTemplateMutation.isPending}
      />
    </div>
  );
}
