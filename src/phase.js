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

// Reduces a DUAL SINC relation (deriv:base) to lowest terms and flags whether
// it's coprime. A non-coprime pair (e.g. 8:4 -> 2:1) is a nested subdivision,
// not a true polyrhythm: the two layers share a divisor and never conflict.
export function reduceRatio(deriv, base) {
  const g = gcd(Math.max(1, deriv), Math.max(1, base)) || 1;
  const num = deriv / g, den = base / g;
  return { num, den, isCoprime: g === 1 };
}

// Perceptual difficulty band of a polyrhythm, by the product of its reduced
// terms (C1: small ratios like 3:2 or 4:3 fuse into one felt figure; large
// ones like 7:5 or 11:8 split into two things the ear can't integrate).
// Pedagogical rule of thumb, not a law — thresholds are empirical, not exact.
export function perceptualBand(deriv, base) {
  const { num, den } = reduceRatio(deriv, base);
  const product = num * den;
  if (product <= 12) return "integrable";
  if (product <= 40) return "separable";
  return "textura";
}

// DUAL SINC: both metronomes span the same cycle, so B's tempo follows from
// how many pulses each side fits into it. `mult` is the ½ / ×1 / ×2 switch.
export function derivedBpm(bpmBase, base, deriv, mult = 1) {
  const b = Math.max(1, base);
  return (bpmBase * mult) * deriv / b;
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
