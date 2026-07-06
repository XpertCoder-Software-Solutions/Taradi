export function debugLog(message: string, data?: unknown) {
  if (!import.meta.env.DEV) {
    return;
  }

  if (data === undefined) {
    console.debug(`[Taradi] ${message}`);
    return;
  }

  console.debug(`[Taradi] ${message}`, data);
}
