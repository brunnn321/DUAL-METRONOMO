import { describe, it, expect, vi } from "vitest";
import { noteName, sendMidiNote, MIDI_NOTE_DURATION_MS } from "./midi.js";

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
