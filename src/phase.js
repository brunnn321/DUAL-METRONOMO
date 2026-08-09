// Pure phase/cycle math shared by the sync ring and the pulse countdowns.
// Kept free of React so it can be tested directly.

export const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
export const lcm = (a, b) => (a * b) / gcd(a, b);

// How many pulses a DUAL POLY cycle lasts: both sides share the tempo, so the
// two downbeats realign every lcm(beatsA, beatsB) pulses.
export function polyCycleTarget(beatsA, beatsB) {
  return lcm(Math.max(1, beatsA), Math.max(1, beatsB));
}

// How many pulses each DUAL LIBRE metronome fires before the pair realigns.
// Two independent integer BPMs starting together land back in phase after
// 60/gcd(bpmA,bpmB) seconds; A has fired bpmA/gcd pulses by then, B bpmB/gcd.
export function libreCycleTargets(bpmA, bpmB) {
  const a = Math.round(bpmA), b = Math.round(bpmB);
  const g = gcd(a, b) || 1;
  return { targetA: a / g, targetB: b / g, seconds: 60 / g };
}

// Position of a pulse inside its cycle, 0 = in phase (12 o'clock).
// pulseCount is 1-based: pulse 1 is the reference click where A and B start
// aligned, so it maps to index 0 — the cycle only returns to 0 on the pulse
// that actually lands back in phase, `target` pulses later.
export function cycleIndex(pulseCount, target) {
  if (!target || target <= 0) return 0;
  return pulseCount > 0 ? (pulseCount - 1) % target : 0;
}

// Pulses left until the pair is back in phase. Shows a full cycle both before
// starting and right after a sync, and 1 on the pulse just before the sync.
export function cycleRemaining(pulseCount, target) {
  if (!target || target <= 0) return 0;
  return target - cycleIndex(pulseCount, target);
}

// True only on a pulse that actually lands back in phase — never on pulse 1
// (the trivial starting alignment) and never before playback begins.
export function isSyncPulse(pulseCount, target) {
  if (!target || target <= 0) return false;
  return pulseCount > 1 && cycleIndex(pulseCount, target) === 0;
}
