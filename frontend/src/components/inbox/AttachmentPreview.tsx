import { FileText, ImageIcon, Music, Video, X } from "lucide-react";
import { formatArabicFileSize, mediaTypeLabel } from "../../lib/i18n";

type AttachmentMediaType = "image" | "audio" | "voice" | "video" | "document";

function PreviewIcon({ mediaType }: { mediaType: AttachmentMediaType }) {
  if (mediaType === "image") return <ImageIcon className="h-5 w-5" />;
  if (mediaType === "video") return <Video className="h-5 w-5" />;
  if (mediaType === "audio" || mediaType === "voice") return <Music className="h-5 w-5" />;

  return <FileText className="h-5 w-5" />;
}

export function AttachmentPreview({
  file,
  mediaType,
  caption,
  onCaptionChange,
  onClear
}: {
  file: File | null;
  mediaType: AttachmentMediaType;
  caption: string;
  onCaptionChange: (value: string) => void;
  onClear: () => void;
}) {
  if (!file) {
    return null;
  }

  return (
    <div className="border-t border-neutral-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3 rounded-lg bg-neutral-50 p-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-[#d9fdd3] text-[#116d4d]">
          <PreviewIcon mediaType={mediaType} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-900">{file.name}</p>
          <p className="text-xs text-ink-500">{mediaTypeLabel[mediaType]} · {formatArabicFileSize(file.size)}</p>
        </div>
        <button type="button" className="rounded-full p-2 text-ink-500 hover:bg-neutral-200" onClick={onClear} aria-label="إزالة المرفق">
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        className="mt-2 h-10 w-full rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-[#25d366] focus:ring-2 focus:ring-[#d9fdd3]"
        value={caption}
        onChange={(event) => onCaptionChange(event.target.value)}
        placeholder="أضف وصفًا للمرفق"
      />
    </div>
  );
}
