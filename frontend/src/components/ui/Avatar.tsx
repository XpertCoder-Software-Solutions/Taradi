import { cn } from "../../lib/cn";

function initialsFromName(value?: string | null) {
  const normalized = (value || "").trim();

  if (!normalized) {
    return "ت";
  }

  return normalized
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  return (
    <div className={cn(
      "grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-mint-700 to-mint-500 text-sm font-black text-white shadow-sm",
      className
    )}>
      {initialsFromName(name)}
    </div>
  );
}
