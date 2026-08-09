import { describe, it, expect } from "vitest";
import { SETTINGS_KEY, loadSettings, saveSettings } from "./settings.js";

// minimal in-memory stand-in for localStorage, so these tests need no DOM
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
}
const throwingStorage = {
  getItem() { throw new Error("SecurityError: storage disabled"); },
  setItem() { throw new Error("QuotaExceededError"); },
};

describe("loadSettings", () => {
  it("returns the stored settings", () => {
    const s = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ mode: "libre", polyBpm: 120 }) });
    expect(loadSettings(s)).toEqual({ mode: "libre", polyBpm: 120 });
  });

  it("returns {} when nothing was ever saved", () => {
    expect(loadSettings(fakeStorage())).toEqual({});
  });

  it("returns {} on corrupt JSON instead of throwing", () => {
    const s = fakeStorage({ [SETTINGS_KEY]: "{not json at all" });
    expect(loadSettings(s)).toEqual({});
  });

  it("returns {} when the stored payload is the literal null", () => {
    const s = fakeStorage({ [SETTINGS_KEY]: "null" });
    expect(loadSettings(s)).toEqual({});
  });

  it("returns {} when the payload is not an object", () => {
    expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: '"a string"' }))).toEqual({});
    expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: "42" }))).toEqual({});
    expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: "[1,2,3]" }))).toEqual({});
  });

  it("returns {} when storage itself throws (private mode)", () => {
    expect(loadSettings(throwingStorage)).toEqual({});
  });

  it("returns {} when there is no storage backend at all", () => {
    expect(loadSettings(undefined)).toEqual({});
    expect(loadSettings(null)).toEqual({});
  });
});

describe("saveSettings", () => {
  it("writes the snapshot and reports success", () => {
    const s = fakeStorage();
    expect(saveSettings({ mode: "polimetria", polyBpm: 90 }, s)).toBe(true);
    expect(JSON.parse(s._data[SETTINGS_KEY])).toEqual({ mode: "polimetria", polyBpm: 90 });
  });

  it("round-trips through loadSettings", () => {
    const s = fakeStorage();
    const snapshot = { mode: "libre", relBase: 4, metA: { bpm: 90, muted: false } };
    saveSettings(snapshot, s);
    expect(loadSettings(s)).toEqual(snapshot);
  });

  it("reports failure instead of throwing when the quota is full", () => {
    expect(saveSettings({ mode: "libre" }, throwingStorage)).toBe(false);
  });

  it("does not throw without a storage backend", () => {
    expect(saveSettings({ mode: "libre" }, undefined)).toBe(true);
  });
});
