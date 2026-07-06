import type { ConversationStatus } from "../../types/api";
import { statusLabel } from "../../lib/i18n";
import { ArabicBadge } from "./ArabicBadge";

const statusTone: Record<ConversationStatus, "green" | "amber" | "neutral"> = {
  OPEN: "green",
  PENDING: "amber",
  CLOSED: "neutral"
};

export function StatusBadge({ status }: { status: ConversationStatus }) {
  return <ArabicBadge tone={statusTone[status]}>{statusLabel[status]}</ArabicBadge>;
}

