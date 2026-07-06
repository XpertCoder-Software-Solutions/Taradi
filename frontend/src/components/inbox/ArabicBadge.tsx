import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

const tones = {
  neutral: "bg-neutral-100 text-ink-700",
  green: "bg-[#d9fdd3] text-[#116d4d]",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700"
};

export function ArabicBadge({ children, tone = "neutral", className }: {
  children: ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

