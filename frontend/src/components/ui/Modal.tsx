import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "../../lib/cn";

export function Modal({ open, title, description, children, footer, onClose, className }: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/45 px-4 py-6 backdrop-blur-sm" dir="rtl">
      <div className={cn("max-h-[90vh] w-full max-w-xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-soft", className)}>
        <div className="flex items-start justify-between gap-4 border-b border-surface-200 px-6 py-5">
          <div>
            <h2 className="text-lg font-black text-ink-900">{title}</h2>
            {description ? <p className="mt-1 text-sm leading-6 text-ink-500">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="إغلاق">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="max-h-[65vh] overflow-auto px-6 py-5">{children}</div>
        {footer ? <div className="border-t border-surface-200 bg-surface-50 px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}
