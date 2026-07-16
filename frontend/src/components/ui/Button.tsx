import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-mint-700 text-white shadow-glow hover:bg-mint-800 disabled:bg-ink-400 disabled:shadow-none",
  secondary: "border border-surface-200 bg-white text-ink-900 shadow-sm hover:border-mint-100 hover:bg-mint-50",
  ghost: "text-ink-700 hover:bg-surface-100",
  danger: "bg-signal-red text-white shadow-sm hover:bg-red-600",
  soft: "bg-mint-50 text-mint-800 hover:bg-mint-100"
};

const sizes: Record<Size, string> = {
  sm: "h-9 rounded-xl px-3 text-xs",
  md: "h-10 rounded-xl px-4 text-sm",
  lg: "h-12 rounded-2xl px-5 text-sm",
  icon: "h-10 w-10 rounded-xl p-0"
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({ className, variant = "primary", size = "md", icon, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
