import { Bell, BellRing, Monitor, Volume2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { enableAudio, playIncomingMessage, disableAudio } from "../lib/audioManager";
import {
  getNotificationPreferences,
  NOTIFICATION_PREFERENCES_EVENT,
  updateNotificationPreferences,
  type NotificationPreferences
} from "../lib/notificationPreferences";

function getBrowserNotificationStatus() {
  if (!("Notification" in window)) {
    return "unsupported";
  }

  return Notification.permission;
}

function ToggleRow({
  icon,
  title,
  description,
  checked,
  onChange
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-surface-200 bg-white px-4 py-4 transition hover:border-mint-100 hover:bg-mint-50/50">
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-mint-50 text-mint-800">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-black text-ink-900">{title}</span>
          <span className="mt-1 block text-xs font-semibold leading-5 text-ink-500">{description}</span>
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 shrink-0 accent-mint-700"
      />
    </label>
  );
}

export function NotificationSettingsPage() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => getNotificationPreferences());
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">(() => getBrowserNotificationStatus());

  useEffect(() => {
    const handlePreferencesChange = (event: Event) => {
      const nextPreferences = (event as CustomEvent<NotificationPreferences>).detail || getNotificationPreferences();
      setPreferences(nextPreferences);
    };

    window.addEventListener(NOTIFICATION_PREFERENCES_EVENT, handlePreferencesChange);

    return () => window.removeEventListener(NOTIFICATION_PREFERENCES_EVENT, handlePreferencesChange);
  }, []);

  async function updatePreference(patch: Partial<NotificationPreferences>) {
    const nextPreferences = updateNotificationPreferences(patch);
    setPreferences(nextPreferences);

    if (patch.newMessageSound !== undefined) {
      if (patch.newMessageSound) {
        await enableAudio();
      } else {
        disableAudio();
      }
    }

    if (patch.browserNotifications && "Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      setBrowserPermission(permission);
    } else {
      setBrowserPermission(getBrowserNotificationStatus());
    }
  }

  async function testSound() {
    await enableAudio();
    playIncomingMessage();
  }

  const permissionLabel = browserPermission === "granted"
    ? "مفعلة من المتصفح"
    : browserPermission === "denied"
      ? "مرفوضة من المتصفح"
      : browserPermission === "default"
        ? "تحتاج موافقة المتصفح"
        : "غير مدعومة";

  return (
    <div className="space-y-6">
      <PageHeader
        title="إعدادات الإشعارات"
        description="تحكم في تنبيهات الرسائل الواردة على هذا الجهاز."
      />

      <Card>
        <CardHeader
          title="الإشعارات"
          description={`حالة إشعارات المتصفح: ${permissionLabel}`}
          action={(
            <Button type="button" variant="secondary" icon={<Volume2 className="h-4 w-4" />} onClick={testSound}>
              تجربة الصوت
            </Button>
          )}
        />
        <CardBody className="space-y-3">
          <ToggleRow
            icon={<Volume2 className="h-5 w-5" />}
            title="تشغيل صوت الرسائل الجديدة"
            description="يشغل صوتًا واضحًا عند وصول رسالة واتساب واردة."
            checked={preferences.newMessageSound}
            onChange={(checked) => void updatePreference({ newMessageSound: checked })}
          />
          <ToggleRow
            icon={<Monitor className="h-5 w-5" />}
            title="تشغيل إشعارات المتصفح"
            description="يعرض إشعارًا من النظام عندما تكون نافذة المتصفح في الخلفية."
            checked={preferences.browserNotifications}
            onChange={(checked) => void updatePreference({ browserNotifications: checked })}
          />
          <ToggleRow
            icon={<BellRing className="h-5 w-5" />}
            title="تشغيل التنبيه حتى إذا كانت المحادثة مفتوحة"
            description="يبقي التنبيه نشطًا للرسائل الجديدة داخل المحادثة المفتوحة."
            checked={preferences.alertWhenConversationOpen}
            onChange={(checked) => void updatePreference({ alertWhenConversationOpen: checked })}
          />
          <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-xs font-semibold leading-6 text-ink-600">
            <Bell className="ml-2 inline h-4 w-4 text-mint-800" />
            يتم حفظ هذه الاختيارات على هذا المتصفح فقط.
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
