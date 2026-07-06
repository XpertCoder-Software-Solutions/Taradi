import { listChats } from "./chats.api";

export async function getUnreadSummary() {
  const result = await listChats({ limit: 100, unreadOnly: true });
  const unreadTotal = result.items.reduce((total, item) => total + item.unreadCount, 0);

  return {
    unreadTotal,
    conversations: result.items
  };
}
