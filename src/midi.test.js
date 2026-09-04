import { describe, it, expect, vi, afterEach } from "vitest";
import { noteName, sendMidiNote, MIDI_NOTE_DURATION_MS, createMidiClockHandler, requestMidiOutput, requestMidiInput, ensureLoopMidiThenRequest } from "./midi.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("noteName", () => {
  it("maps MIDI note numbers to names", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(36)).toBe("C2");
    expect(noteName(38)).toBe("D2");
    expect(noteName(69)).toBe("A4");
  });
  it("clamps out-of-range input", () => {
    expect(noteName(-5)).toBe("C-1");
    expect(noteName(200)).toBe("G9");
  });
});

describe("sendMidiNote", () => {
  it("does nothing without an output", () => {
    expect(() => sendMidiNote(null, 1, 36, 100)).not.toThrow();
  });
  it("sends a noteOn then a matching noteOff on the right channel", () => {
    const send = vi.fn();
    sendMidiNote({ send }, 2, 36, 110, 0, MIDI_NOTE_DURATION_MS);
    expect(send).toHaveBeenCalledTimes(2);
    const [onMsg, onTime] = send.mock.calls[0];
    const [offMsg, offTime] = send.mock.calls[1];
    expect(onMsg).toEqual([0x91, 36, 110]); // noteOn, channel 2 (0-indexed 1)
    expect(offMsg).toEqual([0x81, 36, 0]);  // noteOff, same channel/note
    expect(offTime - onTime).toBeCloseTo(MIDI_NOTE_DURATION_MS, 0);
  });
  it("clamps channel, note and velocity to valid MIDI ranges", () => {
    const send = vi.fn();
    sendMidiNote({ send }, 99, 300, 500, 0, 10);
    const [onMsg] = send.mock.calls[0];
    expect(onMsg[0]).toBe(0x90 | 15); // channel clamped to 16 (index 15)
    expect(onMsg[1]).toBe(127);       // note clamped
    expect(onMsg[2]).toBe(127);       // velocity clamped
  });
});

describe("requestMidiOutput / requestMidiInput", () => {
  it("returns null when the browser has no Web MIDI API", async () => {
    vi.stubGlobal("navigator", {});
    expect(await requestMidiOutput()).toBe(null);
    expect(await requestMidiInput()).toBe(null);
  });

  it("prefers a port named after loopMIDI/dual pulse over the first one found", async () => {
    const wrong = { name: "Microsoft GS Wavetable Synth" };
    const right = { name: "loopMIDI Port 1" };
    vi.stubGlobal("navigator", {
      requestMIDIAccess: vi.fn().mockResolvedValue({
        outputs: new Map([["a", wrong], ["b", right]]),
        inputs: new Map([["a", wrong], ["b", right]]),
      }),
    });
    expect(await requestMidiOutput()).toBe(right);
    expect(await requestMidiInput()).toBe(right);
  });

  it("falls back to the first port when none match a preferred name", async () => {
    const first = { name: "Some Audio Interface" };
    const second = { name: "Another Device" };
    vi.stubGlobal("navigator", {
      requestMIDIAccess: vi.fn().mockResolvedValue({
        outputs: new Map([["a", first], ["b", second]]),
        inputs: new Map(),
      }),
    });
    expect(await requestMidiOutput()).toBe(first);
    expect(await requestMidiInput()).toBe(null); // empty map — nothing to pick
  });
});

describe("ensureLoopMidiThenRequest", () => {
  it("returns the port immediately if requestFn already finds one", async () => {
    const port = { name: "loopMIDI" };
    const requestFn = vi.fn().mockResolvedValue(port);
    expect(await ensureLoopMidiThenRequest(requestFn)).toBe(port);
    expect(requestFn).toHaveBeenCalledTimes(1); // no electron assist needed
  });

  it("returns null with no electron bridge and no port (plain web build)", async () => {
    vi.stubGlobal("window", {});
    const requestFn = vi.fn().mockResolvedValue(null);
    expect(await ensureLoopMidiThenRequest(requestFn)).toBe(null);
  });

  it("asks electronMidi to launch loopMIDI and retries once it did", async () => {
    vi.useFakeTimers();
    const port = { name: "loopMIDI" };
    const requestFn = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(port);
    const ensureLoopMidi = vi.fn().mockResolvedValue({ launched: true });
    vi.stubGlobal("window", { electronMidi: { ensureLoopMidi } });
    const resultPromise = ensureLoopMidiThenRequest(requestFn);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await resultPromise).toBe(port);
    expect(ensureLoopMidi).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("doesn't retry if electronMidi couldn't launch loopMIDI (not installed)", async () => {
    const requestFn = vi.fn().mockResolvedValue(null);
    const ensureLoopMidi = vi.fn().mockResolvedValue({ launched: false, reason: "not-installed" });
    vi.stubGlobal("window", { electronMidi: { ensureLoopMidi } });
    expect(await ensureLoopMidiThenRequest(requestFn)).toBe(null);
    expect(requestFn).toHaveBeenCalledTimes(1);
  });
});

describe("createMidiClockHandler", () => {
  // fake clock: each call to now() advances by `stepMs`, starting at 0
  const fakeClock = (stepMs) => {
    let t = -stepMs;
    return () => { t += stepMs; return t; };
  };
  const feedClockPulses = (handler, count) => {
    for (let i = 0; i < count; i++) handler({ data: [0xf8] });
  };

  it("reports bpm only after a full quarter note of pulses (24 ppqn)", () => {
    const onTempo = vi.fn();
    const handler = createMidiClockHandler({ onTempo, now: fakeClock(1000 / 24 / 2) }); // 120bpm
    feedClockPulses(handler, 23);
    expect(onTempo).not.toHaveBeenCalled();
    feedClockPulses(handler, 1);
    expect(onTempo).toHaveBeenCalledTimes(1);
    expect(onTempo).toHaveBeenCalledWith(120);
  });

  it("throttles repeated tempo updates within MIN_APPLY_INTERVAL_MS", () => {
    const onTempo = vi.fn();
    const now = fakeClock(1000 / 24 / 2); // 120bpm pulse rate
    const handler = createMidiClockHandler({ onTempo, now });
    feedClockPulses(handler, 24); // first 120bpm report
    expect(onTempo).toHaveBeenCalledTimes(1);
    // one more pulse immediately after — same bpm, shouldn't fire even if it differed
    feedClockPulses(handler, 1);
    expect(onTempo).toHaveBeenCalledTimes(1);
  });

  it("calls onStart on Start/Continue and resets the pulse buffer", () => {
    const onStart = vi.fn();
    const onTempo = vi.fn();
    const handler = createMidiClockHandler({ onTempo, onStart, now: fakeClock(20) });
    feedClockPulses(handler, 10);
    handler({ data: [0xfa] }); // Start
    expect(onStart).toHaveBeenCalledTimes(1);
    feedClockPulses(handler, 10); // not enough after reset to report tempo
    expect(onTempo).not.toHaveBeenCalled();
    handler({ data: [0xfb] }); // Continue
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("calls onStop on Stop messages", () => {
    const onStop = vi.fn();
    const handler = createMidiClockHandler({ onStop, now: fakeClock(20) });
    handler({ data: [0xfc] });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("rejects out-of-range bpm from startup jitter", () => {
    const onTempo = vi.fn();
    const handler = createMidiClockHandler({ onTempo, now: fakeClock(1000) }); // absurdly slow pulses
    feedClockPulses(handler, 24);
    expect(onTempo).not.toHaveBeenCalled();
  });
});
