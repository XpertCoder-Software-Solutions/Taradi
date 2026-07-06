import { Wifi, WifiOff } from "lucide-react";
import { useRealtimeStatus } from "../../contexts/SocketProvider";
import { cn } from "../../lib/cn";

const labels = {
  connected: "متصل",
  connecting: "جاري الاتصال",
  disconnected: "غير متصل"
};

export function RealtimeStatus({ compact = false }: { compact?: boolean }) {
  const status = useRealtimeStatus();
  const isConnected = status === "connected";

  return (
    <div className={cn(
      "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
      isConnected ? "bg-[#d9fdd3] text-[#116d4d]" : "bg-neutral-100 text-ink-500"
    )}>
      {isConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {compact ? null : <span>{labels[status]}</span>}
    </div>
  );
}

