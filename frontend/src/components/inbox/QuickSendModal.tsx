import { Loader2, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { User } from "../../types/api";
import { roleLabel } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { FieldShell, Input, Select, Textarea } from "../ui/Field";
import { Modal } from "../ui/Modal";

export interface QuickSendPayload {
  phone: string;
  message: string;
  assignedToId?: string;
}

function normalizePhone(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function QuickSendModal({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  showAssignee,
  assignees,
  assigneesLoading,
  emptyAssigneeLabel
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: QuickSendPayload) => Promise<void>;
  isSubmitting: boolean;
  showAssignee: boolean;
  assignees: User[];
  assigneesLoading: boolean;
  emptyAssigneeLabel: string;
}) {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [errors, setErrors] = useState<{ phone?: string; message?: string }>({});

  useEffect(() => {
    if (!open) {
      setPhone("");
      setMessage("");
      setAssignedToId("");
      setErrors({});
    }
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedPhone = normalizePhone(phone);
    const trimmedMessage = message.trim();
    const nextErrors: typeof errors = {};

    if (normalizedPhone.length < 6) {
      nextErrors.phone = "رقم الهاتف غير صحيح";
    }

    if (!trimmedMessage) {
      nextErrors.message = "الرسالة مطلوبة";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    try {
      await onSubmit({
        phone: normalizedPhone,
        message: trimmedMessage,
        ...(assignedToId ? { assignedToId } : {})
      });
    } catch {
      // The parent mutation surfaces API errors through the shared toast system.
    }
  };

  return (
    <Modal
      open={open}
      title="إرسال رسالة واتساب"
      onClose={isSubmitting ? () => undefined : onClose}
      className="max-w-lg"
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            إلغاء
          </Button>
          <Button type="submit" form="quick-send-form" icon={isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} disabled={isSubmitting}>
            إرسال
          </Button>
        </div>
      )}
    >
      <form id="quick-send-form" className="space-y-4" onSubmit={submit}>
        <FieldShell label="رقم الهاتف" error={errors.phone}>
          <Input
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              if (errors.phone) {
                setErrors((current) => ({ ...current, phone: undefined }));
              }
            }}
            placeholder="201xxxxxxxxx"
            disabled={isSubmitting}
          />
        </FieldShell>

        <FieldShell label="الرسالة" error={errors.message}>
          <Textarea
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              if (errors.message) {
                setErrors((current) => ({ ...current, message: undefined }));
              }
            }}
            maxLength={4096}
            disabled={isSubmitting}
          />
        </FieldShell>

        {showAssignee ? (
          <FieldShell label="المحصل المسؤول">
            <Select
              value={assignedToId}
              onChange={(event) => setAssignedToId(event.target.value)}
              disabled={isSubmitting || assigneesLoading}
            >
              <option value="">{emptyAssigneeLabel}</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {assignee.name} - {roleLabel[assignee.role]}
                </option>
              ))}
            </Select>
          </FieldShell>
        ) : null}
      </form>
    </Modal>
  );
}
