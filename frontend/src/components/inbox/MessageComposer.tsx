import { FileUp, Paperclip, Send, Smile } from "lucide-react";
import { useRef } from "react";
import { mediaTypeLabel } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Select } from "../ui/Field";
import { AttachmentPreview } from "./AttachmentPreview";

export function MessageComposer({
  text,
  mediaType,
  caption,
  file,
  sendingText,
  sendingMedia,
  canSendMessage,
  canSendMedia,
  onTextChange,
  onMediaTypeChange,
  onCaptionChange,
  onFileChange,
  onClearFile,
  onSendText,
  onSendMedia
}: {
  text: string;
  mediaType: "image" | "audio" | "voice" | "document";
  caption: string;
  file: File | null;
  sendingText: boolean;
  sendingMedia: boolean;
  canSendMessage: boolean;
  canSendMedia: boolean;
  onTextChange: (value: string) => void;
  onMediaTypeChange: (value: "image" | "audio" | "voice" | "document") => void;
  onCaptionChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  onClearFile: () => void;
  onSendText: () => void;
  onSendMedia: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <footer className="border-t border-surface-200 bg-surface-50">
      <AttachmentPreview
        file={file}
        mediaType={mediaType}
        caption={caption}
        onCaptionChange={onCaptionChange}
        onClear={onClearFile}
      />

      <div className="flex items-end gap-2 px-4 py-3">
        <button
          type="button"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-surface-200"
          aria-label="إضافة رمز تعبيري"
          title="إضافة رمز تعبيري"
        >
          <Smile className="h-5 w-5" />
        </button>

        {canSendMedia ? (
          <button
            type="button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-surface-200"
            aria-label="إرفاق ملف"
            title="إرفاق ملف"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-5 w-5" />
          </button>
        ) : null}

        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          onChange={(event) => onFileChange(event.target.files?.[0] || null)}
        />

        <div className="min-w-0 flex-1">
          <textarea
            className="max-h-32 min-h-11 w-full resize-none rounded-2xl border border-white bg-white px-4 py-3 text-sm text-ink-900 shadow-sm outline-none placeholder:text-ink-500 focus:border-mint-500 focus:ring-4 focus:ring-mint-100"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder="اكتب رسالة..."
            rows={1}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (text.trim() && !sendingText) {
                  onSendText();
                }
              }
            }}
          />
        </div>

        {file && canSendMedia ? (
          <div className="hidden w-32 md:block">
            <Select value={mediaType} onChange={(event) => onMediaTypeChange(event.target.value as typeof mediaType)}>
              {Object.entries(mediaTypeLabel).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </Select>
          </div>
        ) : null}

        {file && canSendMedia ? (
          <Button
            type="button"
            className="h-11 rounded-full px-4"
            icon={<FileUp className="h-4 w-4" />}
            disabled={sendingMedia}
            onClick={onSendMedia}
          >
            إرسال المرفق
          </Button>
        ) : canSendMessage ? (
          <Button
            type="button"
            size="icon"
            className="rounded-full"
            icon={<Send className="h-4 w-4 rotate-180" />}
            disabled={!text.trim() || sendingText}
            onClick={onSendText}
            aria-label="إرسال"
          />
        ) : null}
      </div>
    </footer>
  );
}
