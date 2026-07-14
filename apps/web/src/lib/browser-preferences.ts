export const autoRefreshStorageKey = "agent-trace:auto-refresh";
export const autoRefreshChangedEvent = "agent-trace:auto-refresh-changed";

export function readAutoRefreshPreference() {
  try {
    return window.localStorage.getItem(autoRefreshStorageKey) !== "off";
  } catch {
    return true;
  }
}

export function writeAutoRefreshPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(autoRefreshStorageKey, enabled ? "on" : "off");
  } catch {
    // Keep the in-memory setting when storage is unavailable.
  }

  window.dispatchEvent(new Event(autoRefreshChangedEvent));
}
