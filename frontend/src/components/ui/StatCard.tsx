import type { ReactNode } from "react";
import { Card } from "./Card";
import { cn } from "../../lib/cn";

export function StatCard({ label, value, icon }: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="absolute -left-10 -top-10 h-28 w-28 rounded-full bg-mint-100/60 blur-2xl" />
      <div className="relative flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-500">{label}</p>
          <p className="mt-2 text-3xl font-black text-ink-900">{value}</p>
        </div>
        {icon ? <div className={cn("grid h-12 w-12 place-items-center rounded-2xl bg-mint-50 text-mint-800 shadow-sm")}>{icon}</div> : null}
      </div>
    </Card>
  );
}
