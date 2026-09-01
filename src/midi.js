// Web MIDI output — sends note on/off pairs at scheduled times so the pulse
// pattern can be captured as real MIDI in an external DAW (e.g. via loopMIDI).
// Kept free of React so the note-name/message logic can be unit-tested.

export const MIDI_NOTE_DURATION_MS = 30;
export const MIDI_VELOCITY_ACCENT = 110;
export const MIDI_VELOCITY_NORMAL = 80;

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// e.g. 36 -> "C1" (MIDI note 60 = C4, standard convention)
export function noteName(note) {
  const n = Math.max(0, Math.min(127, Math.round(note)));
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

// Requests a MIDI output port (Web MIDI API — Chrome/Edge only, not Safari/
// Firefox). Returns the first available output, or null if unsupported,
// denied, or no port exists (e.g. loopMIDI isn't running).
export async function requestMidiOutput() {
  if (!navigator.requestMIDIAccess) return null;
  try {
    const access = await navigator.requestMIDIAccess();
    const first = access.outputs.values().next();
    return first.done ? null : first.value;
  } catch {
    return null;
  }
}

// Sends a noteOn `delayMs` from now and its matching noteOff `durationMs`
// after that. Timestamps are in the same clock as performance.now(), per
// the Web MIDI spec — matches how scheduleBeats already computes delays
// from AudioContext time.
export function sendMidiNote(output, channel, note, velocity, delayMs = 0, durationMs = MIDI_NOTE_DURATION_MS) {
  if (!output) return;
  const ch = Math.max(0, Math.min(15, Math.round(channel) - 1));
  const n  = Math.max(0, Math.min(127, Math.round(note)));
  const v  = Math.max(1, Math.min(127, Math.round(velocity)));
  const at = performance.now() + Math.max(0, delayMs);
  output.send([0x90 | ch, n, v], at);
  output.send([0x80 | ch, n, 0], at + durationMs);
}
