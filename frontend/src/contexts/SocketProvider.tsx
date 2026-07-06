import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AUDIO_BLOCKED_EVENT, disableAudio, enableAudio, playIncomingMessage } from "../lib/audioManager";
import { debugLog } from "../lib/debug";
import {
  getNotificationPreferences,
  NOTIFICATION_PREFERENCES_EVENT,
  NOTIFICATION_PREFERENCES_STORAGE_KEY,
  type NotificationPreferences
} from "../lib/notificationPreferences";
import { connectSocket, disconnectSocket } from "../lib/socketManager";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";
import type { ChatMessagesResponse, Conversation, Message, Paginated, User } from "../types/api";

export type RealtimeConnectionStatus = "connecting" | "connected" | "disconnected";

const RealtimeStatusContext = createContext<RealtimeConnectionStatus>("disconnected");

interface IncomingMessagePayload {
  conversationId?: string | null;
  customerId?: string | null;
  customer?: {
    id?: string;
    name?: string | null;
    phone?: string | null;
  };
  message?: Message;
  conversation?: Conversation | null;
  unreadCount?: number | null;
}

interface UnreadCountPayload {
  unreadTotal?: number;
}

interface PresencePayload {
  userId?: string;
  isOnline?: boolean;
  lastSeenAt?: string | null;
}

function appendIncomingMessage(current: ChatMessagesResponse | undefined, message: Message, conversation?: Conversation | null) {
  if (!current) {
    return current;
  }

  if (current.items.some((item) => item.id === message.id)) {
    return conversation ? { ...current, conversation } : current;
  }

  return {
    ...current,
    conversation: conversation || current.conversation,
    items: [...current.items, message]
  };
}

function updateConversationLists(
  current: Paginated<Conversation> | undefined,
  customerId: string,
  message?: Message,
  conversation?: Conversation | null
) {
  if (!current) {
    return current;
  }

  let updated = false;
  const items = current.items.map((currentConversation) => {
    if (currentConversation.customerId !== customerId) {
      return currentConversation;
    }

    updated = true;
    if (conversation) {
      return conversation;
    }

    if (!message) {
      return currentConversation;
    }

    const isSameLastMessage = currentConversation.lastMessage?.id === message.id;

    return {
      ...currentConversation,
      lastMessage: message,
      lastMessageAt: message.createdAt,
      unreadCount: isSameLastMessage ? currentConversation.unreadCount : currentConversation.unreadCount + 1,
      status: "OPEN" as const,
      updatedAt: message.updatedAt || message.createdAt
    };
  });

  if (!updated) {
    return current;
  }

  return {
    ...current,
    items: items.sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    })
  };
}

function messagePreview(message?: Message) {
  return message?.body || message?.caption || message?.fileName || message?.content || "رسالة واتساب جديدة";
}

function isConversationOpen(customerId?: string | null) {
  if (!customerId || typeof window === "undefined") {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  return window.location.pathname.startsWith("/inbox") && searchParams.get("customerId") === customerId;
}

function showBrowserNotification(customerName: string, preview: string, notificationKey: string, onOpen: () => void) {
  if (!("Notification" in window) || Notification.permission !== "granted" || document.visibilityState === "visible") {
    return;
  }

  const notification = new Notification("رسالة جديدة", {
    body: `${customerName}\n${preview}`,
    tag: `taradi-message-${notificationKey}`
  });

  notification.onclick = () => {
    window.focus();
    onOpen();
    notification.close();
  };
}

function updateUnreadSummary(
  current: { unreadTotal: number; conversations: Conversation[] } | undefined,
  payload: IncomingMessagePayload,
  customerId: string
) {
  if (!current) {
    return current;
  }

  const nextConversation = payload.conversation || null;
  let found = false;
  const conversations = current.conversations.map((conversation) => {
    if (conversation.customerId !== customerId) {
      return conversation;
    }

    found = true;

    if (nextConversation) {
      return nextConversation;
    }

    return {
      ...conversation,
      unreadCount: conversation.unreadCount + 1
    };
  });

  if (!found && nextConversation && nextConversation.unreadCount > 0) {
    conversations.unshift(nextConversation);
  }

  return {
    unreadTotal: conversations.reduce((total, conversation) => total + conversation.unreadCount, 0),
    conversations
  };
}

function updateEmployeePresence(current: Paginated<User> | undefined, payload: PresencePayload, isOnline: boolean) {
  if (!current || !payload.userId) {
    return current;
  }

  let updated = false;
  const items = current.items.map((employee) => {
    if (employee.id !== payload.userId) {
      return employee;
    }

    updated = true;

    return {
      ...employee,
      isOnline,
      lastSeenAt: isOnline ? employee.lastSeenAt ?? null : payload.lastSeenAt ?? employee.lastSeenAt ?? null
    };
  });

  return updated ? { ...current, items } : current;
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>("disconnected");
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => getNotificationPreferences());
  const preferencesRef = useRef(preferences);
  const [showAudioBanner, setShowAudioBanner] = useState(false);
  const statusValue = useMemo(() => connectionStatus, [connectionStatus]);

  useEffect(() => {
    preferencesRef.current = preferences;

    if (!preferences.newMessageSound) {
      disableAudio();
      setShowAudioBanner(false);
    }
  }, [preferences]);

  useEffect(() => {
    const handlePreferencesChange = (event: Event) => {
      const nextPreferences = (event as CustomEvent<NotificationPreferences>).detail || getNotificationPreferences();
      setPreferences(nextPreferences);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== NOTIFICATION_PREFERENCES_STORAGE_KEY) {
        return;
      }

      setPreferences(getNotificationPreferences());
    };

    window.addEventListener(NOTIFICATION_PREFERENCES_EVENT, handlePreferencesChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(NOTIFICATION_PREFERENCES_EVENT, handlePreferencesChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    const handleAudioBlocked = () => {
      if (preferencesRef.current.newMessageSound) {
        setShowAudioBanner(true);
      }
    };

    window.addEventListener(AUDIO_BLOCKED_EVENT, handleAudioBlocked);

    return () => window.removeEventListener(AUDIO_BLOCKED_EVENT, handleAudioBlocked);
  }, []);

  useEffect(() => {
    if (!token) {
      setShowAudioBanner(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      void disconnectSocket("auth_removed");
      setConnectionStatus("disconnected");
      return;
    }

    if (location.pathname === "/login") {
      void disconnectSocket("login_page");
      setConnectionStatus("disconnected");
      return;
    }

    setConnectionStatus("connecting");
    const socket = connectSocket(token);

    if (!socket) {
      setConnectionStatus("disconnected");
      return;
    }

    const cacheUpdatedMessageIds = new Set<string>();
    const notifiedInboundMessageIds = new Set<string>();

    const openConversation = (customerId: string) => {
      navigate(`/inbox?customerId=${encodeURIComponent(customerId)}`);
    };

    const applyIncomingMessage = (payload: IncomingMessagePayload) => {
      const customerId = payload?.customerId || payload?.customer?.id || payload?.message?.customerId;
      const messageId = payload?.message?.id;

      if (customerId && payload?.message) {
        if (!messageId || !cacheUpdatedMessageIds.has(messageId)) {
          queryClient.setQueryData<ChatMessagesResponse>(
            ["messages", customerId],
            (current) => appendIncomingMessage(current, payload.message as Message, payload.conversation)
          );
          queryClient.setQueriesData<Paginated<Conversation>>(
            { queryKey: ["chats"] },
            (current) => updateConversationLists(current, customerId, payload.message as Message, payload.conversation)
          );

          if (payload.message.direction === "INBOUND") {
            queryClient.setQueryData<{ unreadTotal: number; conversations: Conversation[] }>(
              ["notifications", "unread"],
              (current) => updateUnreadSummary(current, payload, customerId)
            );
          }

          if (messageId) {
            cacheUpdatedMessageIds.add(messageId);
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["chats"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      if (customerId) {
        queryClient.invalidateQueries({ queryKey: ["messages", customerId] });
      }
    };

    const handleIncomingConversationMessage = (payload: IncomingMessagePayload) => {
      applyIncomingMessage(payload);

      const message = payload?.message;
      const customerId = payload?.customerId || payload?.customer?.id || message?.customerId;

      if (!message || message.direction !== "INBOUND" || !customerId) {
        return;
      }

      const notificationKey = message.id || `${customerId}:${message.createdAt}`;

      if (notifiedInboundMessageIds.has(notificationKey)) {
        return;
      }

      notifiedInboundMessageIds.add(notificationKey);

      const currentPreferences = preferencesRef.current;
      const conversationIsOpen = isConversationOpen(customerId);

      if (conversationIsOpen && !currentPreferences.alertWhenConversationOpen) {
        return;
      }

      const customerName = payload?.customer?.name || payload?.customer?.phone || "عميل";
      const preview = messagePreview(message);
      const openCurrentConversation = () => openConversation(customerId);

      if (currentPreferences.newMessageSound) {
        playIncomingMessage();
      }

      if (document.visibilityState === "hidden") {
        if (currentPreferences.browserNotifications) {
          showBrowserNotification(customerName, preview, notificationKey, openCurrentConversation);
        }

        return;
      }

      pushToast({
        title: "رسالة جديدة",
        description: `${customerName}\n${preview}`,
        tone: "info",
        onClick: openCurrentConversation
      });
    };

    const handleConversationUpdated = (payload: IncomingMessagePayload) => {
      const customerId = payload?.customerId || payload?.customer?.id || payload?.conversation?.customerId;

      if (customerId && payload?.conversation) {
        queryClient.setQueriesData<Paginated<Conversation>>(
          { queryKey: ["chats"] },
          (current) => updateConversationLists(current, customerId, payload.message, payload.conversation)
        );
      }

      queryClient.invalidateQueries({ queryKey: ["chats"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };

    const handleUnreadCount = (payload: UnreadCountPayload) => {
      queryClient.setQueryData<{ unreadTotal: number; conversations: Conversation[] }>(
        ["notifications", "unread"],
        (current) => current ? { ...current, unreadTotal: payload.unreadTotal || 0 } : current
      );
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };

    const handlePresenceOnline = (payload: PresencePayload) => {
      queryClient.setQueriesData<Paginated<User>>(
        { queryKey: ["employees"] },
        (current) => updateEmployeePresence(current, payload, true)
      );
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    };

    const handlePresenceOffline = (payload: PresencePayload) => {
      queryClient.setQueriesData<Paginated<User>>(
        { queryKey: ["employees"] },
        (current) => updateEmployeePresence(current, payload, false)
      );
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    };

    const handleMessageSent = () => {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    };

    const handleMessageStatus = () => {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    };

    const handleInboxUpdated = (payload: { customerId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      if (payload?.customerId) {
        queryClient.invalidateQueries({ queryKey: ["messages", payload.customerId] });
      }
    };

    const handleConnect = () => {
      setConnectionStatus("connected");
    };

    const handleDisconnect = (reason: string) => {
      debugLog("socket disconnected", { reason });
      setConnectionStatus("disconnected");
    };

    const handleReconnectAttempt = () => {
      setConnectionStatus("connecting");
    };

    const handleConnectError = () => {
      setConnectionStatus("disconnected");
      pushToast({
        title: "تعذر الاتصال الفوري",
        description: "سنحاول إعادة الاتصال تلقائيًا.",
        tone: "error"
      });
    };

    socket.on("conversation:new_message", handleIncomingConversationMessage);
    socket.on("message:received", applyIncomingMessage);
    socket.on("conversation:updated", handleConversationUpdated);
    socket.on("notification:unread_count", handleUnreadCount);
    socket.on("presence:user_online", handlePresenceOnline);
    socket.on("presence:user_offline", handlePresenceOffline);
    socket.on("message:sent", handleMessageSent);
    socket.on("message:status", handleMessageStatus);
    socket.on("inbox:updated", handleInboxUpdated);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.io.on("reconnect_attempt", handleReconnectAttempt);

    if (socket.connected) {
      setConnectionStatus("connected");
    }

    return () => {
      socket.off("conversation:new_message", handleIncomingConversationMessage);
      socket.off("message:received", applyIncomingMessage);
      socket.off("conversation:updated", handleConversationUpdated);
      socket.off("notification:unread_count", handleUnreadCount);
      socket.off("presence:user_online", handlePresenceOnline);
      socket.off("presence:user_offline", handlePresenceOffline);
      socket.off("message:sent", handleMessageSent);
      socket.off("message:status", handleMessageStatus);
      socket.off("inbox:updated", handleInboxUpdated);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.io.off("reconnect_attempt", handleReconnectAttempt);
      setConnectionStatus("disconnected");
    };
  }, [location.pathname, navigate, pushToast, queryClient, token]);

  const activateAudio = () => {
    void enableAudio().then((enabledAudio) => {
      if (enabledAudio) {
        setShowAudioBanner(false);
      }
    });
  };

  return (
    <RealtimeStatusContext.Provider value={statusValue}>
      {children}
      {showAudioBanner && preferences.newMessageSound ? (
        <button
          type="button"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-mint-100 bg-white px-5 py-3 text-sm font-black text-mint-900 shadow-[0_18px_45px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:bg-mint-50 focus:outline-none focus:ring-4 focus:ring-mint-100"
          onClick={activateAudio}
        >
          اضغط هنا لتفعيل صوت الإشعارات
        </button>
      ) : null}
    </RealtimeStatusContext.Provider>
  );
}

export function useRealtimeStatus() {
  return useContext(RealtimeStatusContext);
}
