import { api, unwrap } from "../lib/api";
import type {
  ChatMessagesResponse,
  Conversation,
  ConversationPriority,
  ConversationStatus,
  Message,
  Paginated,
  QueueJob
} from "../types/api";

export interface ChatFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: ConversationStatus;
  assignedEmployeeId?: string;
  unreadOnly?: boolean;
  unassignedOnly?: boolean;
}

export async function listChats(filters: ChatFilters = {}) {
  return unwrap<Paginated<Conversation>>(await api.get("/api/chats", { params: filters }));
}

export async function listMessages(customerId: string) {
  return unwrap<ChatMessagesResponse>(await api.get(`/api/chats/${customerId}/messages`));
}

export async function sendTextMessage(customerId: string, text: string) {
  return unwrap<{ message: Message; job: QueueJob }>(
    await api.post(`/api/chats/${customerId}/messages`, { text })
  );
}

export async function sendMediaMessage(customerId: string, data: {
  file: File;
  type: "image" | "audio" | "voice" | "document";
  caption?: string;
}) {
  const form = new FormData();

  form.append("file", data.file);
  form.append("type", data.type);

  if (data.caption) {
    form.append("caption", data.caption);
  }

  return unwrap<{ message: Message; job: QueueJob }>(
    await api.post(`/api/chats/${customerId}/messages/media`, form)
  );
}

export async function markRead(customerId: string) {
  return unwrap<{ conversation: Conversation; readState: unknown }>(
    await api.patch(`/api/chats/${customerId}/read`)
  );
}

export async function updateStatus(customerId: string, status: ConversationStatus) {
  return unwrap<{ conversation: Conversation }>(
    await api.patch(`/api/chats/${customerId}/status`, { status })
  );
}

export async function updatePriority(customerId: string, priority: ConversationPriority) {
  return unwrap<{ conversation: Conversation }>(
    await api.patch(`/api/chats/${customerId}/priority`, { priority })
  );
}
