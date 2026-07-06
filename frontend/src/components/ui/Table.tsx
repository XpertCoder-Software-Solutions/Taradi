import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-b-2xl", className)}>{children}</div>;
}

export function DataTable({ children, minWidth = "760px" }: { children: ReactNode; minWidth?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 border-b border-surface-200 bg-surface-50 text-xs font-bold text-ink-500">
      {children}
    </thead>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-surface-200">{children}</tbody>;
}

export function TableRow({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("transition hover:bg-mint-50/45", className)}>{children}</tr>;
}

export function TableCell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-5 py-4 align-middle", className)}>{children}</td>;
}

export function TableHeaderCell({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cn("px-5 py-3 align-middle", className)}>{children}</th>;
}
