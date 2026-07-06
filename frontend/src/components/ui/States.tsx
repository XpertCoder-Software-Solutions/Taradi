import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { translateApiError } from "../../lib/i18n";
import { cn } from "../../lib/cn";

export function LoadingState({ label = "جاري التحميل..." }: { label?: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center gap-2 text-sm font-medium text-ink-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-mint-50 text-mint-700">
        {icon || <Inbox className="h-5 w-5" />}
      </div>
      <p className="text-sm font-bold text-ink-900">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-ink-500">{description}</p> : null}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="flex min-h-32 items-center justify-center gap-2 px-6 text-sm font-medium text-signal-red">
      <AlertCircle className="h-4 w-4" />
      {translateApiError(error) || "حدث خطأ أثناء تحميل البيانات"}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-100", className)} />;
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className="h-9" />
          ))}
        </div>
      ))}
    </div>
  );
}
