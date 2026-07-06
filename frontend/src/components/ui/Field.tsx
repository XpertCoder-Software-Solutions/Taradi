import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function FieldShell({ label, error, children }: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-700">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-xs font-medium text-signal-red">{error}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      {...props}
      className={cn(
        "h-11 w-full rounded-xl border border-surface-200 bg-white px-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 hover:border-neutral-300 focus:border-mint-700 focus:ring-4 focus:ring-mint-100 disabled:cursor-not-allowed disabled:bg-surface-50",
        className
      )}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={cn(
        "min-h-28 w-full resize-y rounded-xl border border-surface-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 hover:border-neutral-300 focus:border-mint-700 focus:ring-4 focus:ring-mint-100 disabled:cursor-not-allowed disabled:bg-surface-50",
        className
      )}
    />
  );
});

const selectArrowImage = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%230A6C61' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, style, ...props },
  ref
) {
  return (
    <select
      ref={ref}
      {...props}
      style={{
        backgroundImage: selectArrowImage,
        backgroundPosition: "left 0.85rem center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "1rem",
        ...style
      }}
      className={cn(
        "premium-select h-11 w-full appearance-none rounded-xl border border-surface-200 bg-white py-0 pl-10 pr-3 text-sm font-semibold text-ink-900 shadow-sm outline-none transition hover:border-mint-100 hover:bg-mint-50/40 focus:border-mint-700 focus:bg-white focus:ring-4 focus:ring-mint-100 disabled:cursor-not-allowed disabled:bg-surface-50 disabled:text-ink-400",
        className
      )}
    />
  );
});
