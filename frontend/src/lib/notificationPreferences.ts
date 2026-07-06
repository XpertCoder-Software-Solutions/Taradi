export interface NotificationPreferences {
  newMessageSound: boolean;
  browserNotifications: boolean;
  alertWhenConversationOpen: boolean;
}

export const NOTIFICATION_PREFERENCES_EVENT = "taradi:notification-preferences";
export const NOTIFICATION_PREFERENCES_STORAGE_KEY = "taradi.notificationPreferences.v1";

export const defaultNotificationPreferences: NotificationPreferences = {
  newMessageSound: true,
  browserNotifications: true,
  alertWhenConversationOpen: true
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getNotificationPreferences(): NotificationPreferences {
  if (!canUseStorage()) {
    return defaultNotificationPreferences;
  }

  try {
    const raw = window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY);

    if (!raw) {
      return defaultNotificationPreferences;
    }

    return {
      ...defaultNotificationPreferences,
      ...JSON.parse(raw)
    };
  } catch {
    return defaultNotificationPreferences;
  }
}

export function saveNotificationPreferences(nextPreferences: NotificationPreferences) {
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify(nextPreferences));
    } catch {
      // Local persistence is best effort; live preferences still update this session.
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<NotificationPreferences>(NOTIFICATION_PREFERENCES_EVENT, {
      detail: nextPreferences
    }));
  }
}

export function updateNotificationPreferences(patch: Partial<NotificationPreferences>) {
  const nextPreferences = {
    ...getNotificationPreferences(),
    ...patch
  };

  saveNotificationPreferences(nextPreferences);
  return nextPreferences;
}
