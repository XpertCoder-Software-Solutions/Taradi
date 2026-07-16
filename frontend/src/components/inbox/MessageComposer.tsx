import EmojiPicker, { EmojiStyle, Theme, type EmojiClickData } from "emoji-picker-react";
import { FileText, FileUp, Mic, Paperclip, Send, Smile, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mediaTypeLabel } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Select } from "../ui/Field";
import { AttachmentPreview } from "./AttachmentPreview";

type ComposerMediaType = "image" | "audio" | "voice" | "video" | "document";
type StopAction = "cancel" | "send" | null;

const microphonePermissionMessage = "يجب السماح باستخدام الميكروفون لتسجيل رسالة صوتية.";

function formatRecordingTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  const candidates = [
    "audio/ogg;codecs=opus",
    "audio/webm;codecs=opus",
    "audio/ogg",
    "audio/webm"
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function extensionFromMimeType(mimeType: string) {
  return mimeType.includes("ogg") ? "ogg" : "webm";
}

export function MessageComposer({
  text,
  mediaType,
  caption,
  file,
  sendingText,
  sendingMedia,
  sendingVoice,
  sendingTemplate,
  canSendMessage,
  canSendMedia,
  canSendTemplate,
  onTextChange,
  onMediaTypeChange,
  onCaptionChange,
  onFileChange,
  onClearFile,
  onSendText,
  onSendMedia,
  onSendVoice,
  onOpenTemplateModal
}: {
  text: string;
  mediaType: ComposerMediaType;
  caption: string;
  file: File | null;
  sendingText: boolean;
  sendingMedia: boolean;
  sendingVoice: boolean;
  sendingTemplate: boolean;
  canSendMessage: boolean;
  canSendMedia: boolean;
  canSendTemplate: boolean;
  onTextChange: (value: string) => void;
  onMediaTypeChange: (value: ComposerMediaType) => void;
  onCaptionChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  onClearFile: () => void;
  onSendText: () => void;
  onSendMedia: () => void;
  onSendVoice: (file: File) => void;
  onOpenTemplateModal: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopActionRef = useRef<StopAction>(null);
  const timerRef = useRef<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  useEffect(() => {
    if (!emojiOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        emojiPickerRef.current?.contains(target) ||
        emojiButtonRef.current?.contains(target)
      ) {
        return;
      }

      setEmojiOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [emojiOpen]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function insertEmoji(emojiData: EmojiClickData) {
    const emoji = emojiData.emoji;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    const nextCursor = start + emoji.length;

    onTextChange(nextText);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function stopRecorder(action: StopAction) {
    stopActionRef.current = action;

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
      return;
    }

    setRecording(false);
  }

  async function startRecording() {
    setRecordingError(null);
    setEmojiOpen(false);

    if (!canSendMedia || sendingVoice || sendingMedia) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingError(microphonePermissionMessage);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      stopActionRef.current = null;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const action = stopActionRef.current;
        const recordedMimeType = recorder.mimeType || mimeType || "audio/webm";

        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }

        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        setRecordingSeconds(0);

        if (action === "send" && chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: recordedMimeType });
          const cleanMimeType = recordedMimeType.split(";")[0] || "audio/webm";
          const extension = extensionFromMimeType(cleanMimeType);
          const voiceFile = new File([blob], `voice-note-${Date.now()}.${extension}`, {
            type: recordedMimeType
          });

          onSendVoice(voiceFile);
        }

        chunksRef.current = [];
        stopActionRef.current = null;
      };

      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((value) => value + 1);
      }, 1000);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setRecording(false);
      setRecordingError(microphonePermissionMessage);
    }
  }

  const hasText = Boolean(text.trim());

  return (
    <footer className="relative border-t border-surface-200 bg-surface-50">
      <AttachmentPreview
        file={file}
        mediaType={mediaType}
        caption={caption}
        onCaptionChange={onCaptionChange}
        onClear={onClearFile}
      />

      {recording ? (
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl bg-white px-4 shadow-sm">
            <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="shrink-0 font-mono text-sm font-bold text-red-600" dir="ltr">{formatRecordingTime(recordingSeconds)}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-700">جاري تسجيل رسالة صوتية</span>
          </div>
          <button
            type="button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-red-600 shadow-sm transition hover:bg-red-50"
            aria-label="إلغاء التسجيل"
            title="إلغاء التسجيل"
            onClick={() => stopRecorder("cancel")}
          >
            <Trash2 className="h-5 w-5" />
          </button>
          <Button
            type="button"
            size="icon"
            className="h-11 w-11 rounded-full"
            icon={<Send className="h-4 w-4 rotate-180" />}
            disabled={recordingSeconds < 1 || sendingVoice}
            onClick={() => stopRecorder("send")}
            aria-label="إرسال التسجيل"
          />
        </div>
      ) : (
        <div className="flex items-end gap-2 px-4 py-3">
          <button
            ref={emojiButtonRef}
            type="button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-surface-200"
            aria-label="إضافة رمز تعبيري"
            title="إضافة رمز تعبيري"
            onClick={() => setEmojiOpen((value) => !value)}
          >
            {emojiOpen ? <X className="h-5 w-5" /> : <Smile className="h-5 w-5" />}
          </button>

          {canSendMedia ? (
            <button
              type="button"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-surface-200"
              aria-label="إرفاق ملف"
              title="إرفاق ملف"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendingMedia || sendingVoice}
            >
              <Paperclip className="h-5 w-5" />
            </button>
          ) : null}

          {canSendTemplate ? (
            <button
              type="button"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-surface-200"
              aria-label="إرسال قالب"
              title="إرسال قالب"
              onClick={onOpenTemplateModal}
              disabled={sendingTemplate || sendingText || sendingMedia || sendingVoice}
            >
              <FileText className="h-5 w-5" />
            </button>
          ) : null}

          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            onChange={(event) => onFileChange(event.target.files?.[0] || null)}
          />

          <div className="min-w-0 flex-1">
            <textarea
              ref={textareaRef}
              className="max-h-32 min-h-11 w-full resize-none rounded-2xl border border-white bg-white px-4 py-3 text-sm text-ink-900 shadow-sm outline-none placeholder:text-ink-500 focus:border-mint-500 focus:ring-4 focus:ring-mint-100"
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder="اكتب رسالة..."
              rows={1}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (hasText && canSendMessage && !sendingText) {
                    onSendText();
                  }
                }
              }}
            />
          </div>

          {file && canSendMedia ? (
            <div className="hidden w-32 md:block">
              <Select value={mediaType} onChange={(event) => onMediaTypeChange(event.target.value as ComposerMediaType)}>
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
          ) : hasText && canSendMessage ? (
            <Button
              type="button"
              size="icon"
              className="h-11 w-11 rounded-full"
              icon={<Send className="h-4 w-4 rotate-180" />}
              disabled={sendingText}
              onClick={onSendText}
              aria-label="إرسال"
            />
          ) : canSendMedia ? (
            <button
              type="button"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-mint-700 text-white shadow-glow transition hover:bg-mint-800 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="تسجيل رسالة صوتية"
              title="تسجيل رسالة صوتية"
              disabled={sendingVoice || sendingMedia}
              onClick={startRecording}
            >
              <Mic className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      )}

      {emojiOpen && !recording ? (
        <div ref={emojiPickerRef} className="absolute bottom-[76px] right-4 z-30 overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-2xl" dir="rtl">
          <EmojiPicker
            onEmojiClick={insertEmoji}
            width={330}
            height={360}
            theme={Theme.LIGHT}
            emojiStyle={EmojiStyle.NATIVE}
            lazyLoadEmojis
            searchPlaceholder="ابحث عن رمز"
            searchClearButtonLabel="مسح"
            previewConfig={{ showPreview: false }}
          />
        </div>
      ) : null}

      {recordingError ? (
        <p className="px-4 pb-3 text-sm font-semibold text-red-700">{recordingError}</p>
      ) : null}
    </footer>
  );
}
