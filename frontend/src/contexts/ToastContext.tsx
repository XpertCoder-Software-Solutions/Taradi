import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: "info" | "success" | "error";
  createdAt: string;
  onClick?: () => void;
}

interface ToastContextValue {
  toasts: ToastItem[];
  pushToast: (toast: Omit<ToastItem, "id" | "createdAt">) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<ToastItem, "id" | "createdAt">) => {
    const item: ToastItem = {
      ...toast,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    setToasts((current) => [item, ...current].slice(0, 30));
    window.setTimeout(() => dismissToast(item.id), 6000);
  }, [dismissToast]);

  const value = useMemo(() => ({ toasts, pushToast, dismissToast }), [dismissToast, pushToast, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed left-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3" dir="rtl">
        {toasts.slice(0, 4).map((toast) => (
          <div
            key={toast.id}
            role={toast.onClick ? "button" : undefined}
            tabIndex={toast.onClick ? 0 : undefined}
            className={cn(
              "rounded-2xl border bg-white/95 p-4 shadow-soft outline-none backdrop-blur transition",
              toast.onClick && "cursor-pointer hover:-translate-y-0.5 hover:border-mint-100 hover:bg-mint-50/90 focus:ring-4 focus:ring-mint-100",
              toast.tone === "error" && "border-red-200",
              toast.tone === "success" && "border-mint-100",
              (!toast.tone || toast.tone === "info") && "border-surface-200"
            )}
            onClick={toast.onClick}
            onKeyDown={(event) => {
              if (!toast.onClick || (event.key !== "Enter" && event.key !== " ")) {
                return;
              }

              event.preventDefault();
              toast.onClick();
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-ink-900">{toast.title}</p>
                {toast.description ? <p className="mt-1 whitespace-pre-line text-sm leading-6 text-ink-500">{toast.description}</p> : null}
              </div>
              <button
                className="rounded-lg p-1 text-ink-500 hover:bg-surface-100 hover:text-ink-900"
                onClick={(event) => {
                  event.stopPropagation();
                  dismissToast(toast.id);
                }}
                aria-label="إغلاق الإشعار"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return context;
}
