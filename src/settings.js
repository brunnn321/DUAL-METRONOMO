// Session persistence. Only stable config is stored — never live playback
// state (beat/subTick/running), so a reload restores the setup, not a
// half-finished bar.

export const SETTINGS_KEY = "dualpulse-settings-v1";

// Always returns a plain object. A corrupt entry, a `null` payload, a
// non-object payload, or a storage backend that throws (private mode,
// disabled cookies) must never keep the app from starting.
export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Writing is best-effort: a full quota or a read-only storage should not
// surface as an error to someone in the middle of practising.
export function saveSettings(snapshot, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}
