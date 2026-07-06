import type { ConversationPriority } from "../../types/api";
import { priorityLabel } from "../../lib/i18n";
import { ArabicBadge } from "./ArabicBadge";

const priorityTone: Record<ConversationPriority, "neutral" | "green" | "amber" | "red"> = {
  LOW: "neutral",
  NORMAL: "green",
  HIGH: "amber",
  URGENT: "red"
};

export function PriorityBadge({ priority }: { priority: ConversationPriority }) {
  return <ArabicBadge tone={priorityTone[priority]}>{priorityLabel[priority]}</ArabicBadge>;
}

