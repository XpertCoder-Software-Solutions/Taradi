import {
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  Info,
  Music,
  Paperclip,
  Pause,
  Play,
  RefreshCw,
  Send,
  Video,
  Volume2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { messageMediaEndpoint } from "../../lib/api";
import { cn } from "../../lib/cn";
import { getStoredToken } from "../../lib/storage";
import {
  formatArabicFileSize,
  formatChatTime,
  friendlyMessageFailureReason,
  isDirectTextWindowFailureReason,
  messageStatusLabel
} from "../../lib/i18n";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../ui/Button";
import type { Message, MessageType } from "../../types/api";

const mediaPlaceholderPattern = /^\[(image|video|audio|voice|document|sticker)\]$/i;
const waveformBars = [28, 46, 68, 38, 74, 52, 34, 62, 84, 44, 70, 58, 32, 76, 50, 88, 42, 66, 36, 72, 54, 80, 48, 64, 34, 78, 56, 40];
let activeAudioElement: HTMLAudioElement | null = null;

type MediaLoadState = "idle" | "pending" | "loading" | "ready" | "error";

function MediaIcon({ type, className }: { type: MessageType; className?: string }) {
  if (type === "IMAGE" || type === "STICKER") return <ImageIcon className={className || "h-4 w-4"} />;
  if (type === "VIDEO") return <Video className={className || "h-4 w-4"} />;
  if (type === "DOCUMENT") return <FileText className={className || "h-4 w-4"} />;
  if (type === "VOICE") return <Volume2 className={className || "h-4 w-4"} />;
  if (type === "AUDIO") return <Music className={className || "h-4 w-4"} />;
  return <Paperclip className={className || "h-4 w-4"} />;
}

function mediaTypeLabel(type: MessageType, message?: Message) {
  if (type === "IMAGE") return "صورة";
  if (type === "VIDEO") return "فيديو";
  if (type === "AUDIO") return "مقطع صوتي";
  if (type === "VOICE") return "رسالة صوتية";
  if (type === "STICKER") return "ملصق";
  if (type === "DOCUMENT") {
    const fileName = message?.fileName || "";
    return message?.mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")
      ? "ملف PDF"
      : "مستند";
  }
  return "وسائط";
}

function firstDisplayText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || "").trim();

    if (text && !mediaPlaceholderPattern.test(text)) {
      return text;
    }
  }

  return null;
}

function formatDuration(value?: number | null) {
  if (!value || !Number.isFinite(value)) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useAuthenticatedMedia(message: Message) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [state, setState] = useState<MediaLoadState>("idle");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!["IMAGE", "VIDEO", "AUDIO", "VOICE", "DOCUMENT", "STICKER"].includes(message.type)) {
      setObjectUrl(null);
      setState("idle");
      return;
    }

    if (!message.mediaUrl) {
      setObjectUrl(null);
      setState(message.mediaId ? "pending" : "error");
      return;
    }

    const controller = new AbortController();
    let localUrl: string | null = null;

    setObjectUrl(null);
    setState("loading");

    fetch(messageMediaEndpoint(message.id), {
      signal: controller.signal,
      headers: {
        ...(getStoredToken() ? { Authorization: `Bearer ${getStoredToken()}` } : {})
      }
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("media_fetch_failed");
        }

        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) {
          return;
        }

        localUrl = URL.createObjectURL(blob);
        setObjectUrl(localUrl);
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setObjectUrl(null);
          setState("error");
        }
      });

    return () => {
      controller.abort();
      if (localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [message.id, message.mediaId, message.mediaUrl, message.type, retryToken]);

  return {
    mediaUrl: objectUrl,
    state,
    retry: () => setRetryToken((current) => current + 1)
  };
}

function MediaFallback({ type, message, onRetry }: { type: MessageType; message: Message; onRetry?: () => void }) {
  return (
    <div className="flex min-w-56 items-center gap-3 rounded-xl border border-black/5 bg-black/[0.035] px-3 py-3 text-ink-700">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/80 text-mint-800">
        <MediaIcon type={type} className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{mediaTypeLabel(type, message)}</p>
        <p className="truncate text-xs text-ink-500">تعذر تحميل الوسائط الآن</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-mint-800 shadow-sm transition hover:bg-mint-50"
          onClick={onRetry}
          aria-label="إعادة تحميل الوسائط"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function MediaPending({ type, message, label }: { type: MessageType; message: Message; label?: string }) {
  return (
    <div className="flex min-w-56 items-center gap-3 rounded-xl border border-black/5 bg-black/[0.035] px-3 py-3 text-ink-700">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/80 text-mint-800">
        <MediaIcon type={type} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold">{mediaTypeLabel(type, message)}</p>
        <p className="truncate text-xs text-ink-500">{label || "جاري تحميل الوسائط..."}</p>
      </div>
    </div>
  );
}

function Caption({ message }: { message: Message }) {
  const text = firstDisplayText(message.caption, message.body);

  return text ? <p className="whitespace-pre-wrap px-0.5 leading-6">{text}</p> : null;
}

function ImageMedia({ message, mediaUrl, onPreview, onRetry }: {
  message: Message;
  mediaUrl: string | null;
  onPreview: (url: string) => void;
  onRetry?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="space-y-2">
      {mediaUrl && !failed ? (
        <button
          type="button"
          className="block overflow-hidden rounded-xl bg-black/5 focus:outline-none focus:ring-2 focus:ring-mint-500"
          onClick={() => onPreview(mediaUrl)}
          aria-label="عرض الصورة"
        >
          {!loaded ? (
            <div className="flex h-44 w-64 max-w-full items-center justify-center gap-2 text-sm font-semibold text-ink-500">
              <ImageIcon className="h-5 w-5" />
              جاري تحميل الصورة...
            </div>
          ) : null}
          <img
            src={mediaUrl}
            alt={message.caption || message.fileName || "صورة واتساب"}
            className={cn("max-h-80 max-w-full object-contain", loaded ? "block" : "hidden")}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </button>
      ) : (
        <MediaFallback type="IMAGE" message={message} onRetry={onRetry} />
      )}
      <Caption message={message} />
    </div>
  );
}

function StickerMedia({ message, mediaUrl, onPreview, onRetry }: {
  message: Message;
  mediaUrl: string | null;
  onPreview: (url: string) => void;
  onRetry?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!mediaUrl || failed) {
    return <MediaFallback type="STICKER" message={message} onRetry={onRetry} />;
  }

  return (
    <button
      type="button"
      className="block rounded-xl bg-transparent p-1 focus:outline-none focus:ring-2 focus:ring-mint-500"
      onClick={() => onPreview(mediaUrl)}
      aria-label="عرض الملصق"
    >
      {!loaded ? (
        <div className="flex h-32 w-32 items-center justify-center rounded-xl bg-black/[0.035] text-ink-500">
          <ImageIcon className="h-5 w-5" />
        </div>
      ) : null}
      <img
        src={mediaUrl}
        alt="ملصق واتساب"
        className={cn("max-h-44 max-w-44 object-contain", loaded ? "block" : "hidden")}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function VideoMedia({ message, mediaUrl, onRetry }: { message: Message; mediaUrl: string | null; onRetry?: () => void }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="space-y-2">
      {mediaUrl && !failed ? (
        <video
          src={mediaUrl}
          controls
          preload="metadata"
          className="max-h-80 w-[min(420px,74vw)] rounded-xl bg-black"
          onError={() => setFailed(true)}
        />
      ) : (
        <MediaFallback type="VIDEO" message={message} onRetry={onRetry} />
      )}
      <Caption message={message} />
    </div>
  );
}

function AudioMedia({ message, mediaUrl, onRetry }: { message: Message; mediaUrl: string | null; onRetry?: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const duration = loadedDuration || message.duration || 0;
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  async function togglePlayback() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      try {
        if (activeAudioElement && activeAudioElement !== audio) {
          activeAudioElement.pause();
        }
        activeAudioElement = audio;
        await audio.play();
        setIsPlaying(true);
      } catch (error) {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  function seek(event: MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    const target = waveformRef.current;

    if (!audio || !target || !duration) {
      return;
    }

    const rect = target.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  }

  if (!mediaUrl || failed) {
    return <MediaFallback type={message.type} message={message} onRetry={onRetry} />;
  }

  return (
    <div className="w-[min(340px,76vw)]" dir="ltr">
      <audio
        ref={audioRef}
        src={mediaUrl}
        preload="metadata"
        onLoadedMetadata={(event) => setLoadedDuration(event.currentTarget.duration || null)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={(event) => {
          if (activeAudioElement === event.currentTarget) {
            activeAudioElement = null;
          }
          setIsPlaying(false);
        }}
        onPause={(event) => {
          if (activeAudioElement === event.currentTarget) {
            activeAudioElement = null;
          }
          setIsPlaying(false);
        }}
        onPlay={() => setIsPlaying(true)}
        onError={() => setFailed(true)}
      />
      <div className="flex items-center gap-3 rounded-2xl bg-white/45 px-2.5 py-2">
        <button
          type="button"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mint-700 text-white shadow-sm transition hover:bg-mint-800"
          onClick={togglePlayback}
          aria-label={isPlaying ? "إيقاف الصوت مؤقتًا" : "تشغيل الصوت"}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <div className="min-w-0 flex-1">
          <div ref={waveformRef} className="flex h-8 cursor-pointer items-center gap-0.5" onClick={seek}>
            {waveformBars.map((height, index) => {
              const active = index / waveformBars.length <= progress;

              return (
                <span
                  key={`${height}-${index}`}
                  className={cn("w-1 rounded-full transition-colors", active ? "bg-mint-700" : "bg-ink-300/70")}
                  style={{ height: `${height}%` }}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-ink-500">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mint-50 text-mint-800">
          {message.type === "VOICE" ? <Volume2 className="h-4 w-4" /> : <Music className="h-4 w-4" />}
        </div>
      </div>
    </div>
  );
}

function DocumentMedia({ message, mediaUrl, onRetry }: { message: Message; mediaUrl: string | null; onRetry?: () => void }) {
  const isPdf = message.mimeType === "application/pdf" || String(message.fileName || "").toLowerCase().endsWith(".pdf");
  const fileName = message.fileName || (isPdf ? "ملف PDF" : "مستند");

  return (
    <div className="min-w-64 space-y-2">
      <div className="flex items-center gap-3 rounded-xl border border-black/5 bg-black/[0.035] p-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/90 text-mint-800">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{fileName}</p>
          <p className="text-xs text-ink-500">{isPdf ? "PDF" : message.mimeType || "ملف"} · {formatArabicFileSize(message.fileSize)}</p>
        </div>
      </div>
      <Caption message={message} />
      {mediaUrl ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-white px-3 text-xs font-bold text-mint-800 shadow-sm transition hover:bg-mint-50"
            href={mediaUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            فتح الملف
          </a>
          <a
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-white px-3 text-xs font-bold text-ink-700 shadow-sm transition hover:bg-surface-50"
            href={mediaUrl}
            download={fileName}
          >
            <Download className="h-3.5 w-3.5" />
            تنزيل
          </a>
        </div>
      ) : (
        <MediaFallback type="DOCUMENT" message={message} onRetry={onRetry} />
      )}
    </div>
  );
}

function UnsupportedMessage() {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-black/[0.035] px-3 py-2 text-ink-600">
      <Info className="h-4 w-4 shrink-0" />
      <span>رسالة غير مدعومة</span>
    </div>
  );
}

function MessageContent({ message, mediaUrl, onPreview, mediaState, onRetry }: {
  message: Message;
  mediaUrl: string | null;
  onPreview: (url: string) => void;
  mediaState: MediaLoadState;
  onRetry: () => void;
}) {
  const text = firstDisplayText(message.body, message.content, message.caption, message.fileName, message.templateName);
  const isMediaMessage = ["IMAGE", "VIDEO", "AUDIO", "VOICE", "DOCUMENT", "STICKER"].includes(message.type);

  if (isMediaMessage && (mediaState === "loading" || mediaState === "pending")) {
    return (
      <div className="space-y-2">
        <MediaPending
          type={message.type}
          message={message}
          label={mediaState === "pending" ? "جاري تحميل الوسائط..." : undefined}
        />
        <Caption message={message} />
      </div>
    );
  }

  if (message.type === "IMAGE") {
    return <ImageMedia message={message} mediaUrl={mediaUrl} onPreview={onPreview} onRetry={onRetry} />;
  }

  if (message.type === "VIDEO") {
    return <VideoMedia message={message} mediaUrl={mediaUrl} onRetry={onRetry} />;
  }

  if (message.type === "AUDIO" || message.type === "VOICE") {
    return <AudioMedia message={message} mediaUrl={mediaUrl} onRetry={onRetry} />;
  }

  if (message.type === "DOCUMENT") {
    return <DocumentMedia message={message} mediaUrl={mediaUrl} onRetry={onRetry} />;
  }

  if (message.type === "STICKER") {
    return <StickerMedia message={message} mediaUrl={mediaUrl} onPreview={onPreview} onRetry={onRetry} />;
  }

  if (message.type === "UNKNOWN") {
    return <UnsupportedMessage />;
  }

  return text
    ? <p className="whitespace-pre-wrap leading-6">{text}</p>
    : <UnsupportedMessage />;
}

export function MessageBubble({ message }: { message: Message }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const isOutbound = message.direction === "OUTBOUND";
  const media = useAuthenticatedMedia(message);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const failed = message.status === "FAILED";
  const failureReason = failed ? friendlyMessageFailureReason(message.error) : null;
  const canSendTemplate = failed &&
    isOutbound &&
    isDirectTextWindowFailureReason(message.error) &&
    hasPermission("campaigns.view") &&
    hasPermission("campaigns.send");
  const isMedia = useMemo(() => ["IMAGE", "VIDEO", "AUDIO", "VOICE", "DOCUMENT", "STICKER"].includes(message.type), [message.type]);

  return (
    <>
      <div className={cn("flex", isOutbound ? "justify-start" : "justify-end")}>
        <div className={cn(
          "max-w-[84%] rounded-2xl px-3 py-2 text-sm shadow-sm md:max-w-[70%]",
          isOutbound ? "rounded-tr-sm bg-mint-100 text-ink-900" : "rounded-tl-sm bg-white text-ink-900",
          isMedia && "px-2.5",
          failed && "border border-red-200 bg-red-50"
        )}>
          <MessageContent message={message} mediaUrl={media.mediaUrl} mediaState={media.state} onPreview={setPreviewUrl} onRetry={media.retry} />

          <div className={cn("mt-1 flex items-center justify-end gap-2 text-[11px]", failed ? "text-red-700" : "text-ink-500")}>
            <span>{formatChatTime(message.createdAt)}</span>
            {isOutbound ? <span>{messageStatusLabel[message.status]}</span> : null}
          </div>
          {failureReason ? <p className="mt-1 text-xs leading-5 text-red-700">{failureReason}</p> : null}
          {canSendTemplate ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2 border-red-100 bg-white text-red-800 hover:bg-red-50"
              icon={<Send className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/campaigns?customerId=${encodeURIComponent(message.customerId)}`)}
            >
              إرسال قالب واتساب
            </Button>
          ) : null}
        </div>
      </div>

      {previewUrl ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 cursor-zoom-out" aria-label="إغلاق المعاينة" onClick={() => setPreviewUrl(null)} />
          <button
            type="button"
            className="absolute left-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/12 text-white backdrop-blur transition hover:bg-white/20"
            onClick={() => setPreviewUrl(null)}
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
          <img src={previewUrl} alt="معاينة الوسائط" className="relative z-10 max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" />
        </div>
      ) : null}
    </>
  );
}
