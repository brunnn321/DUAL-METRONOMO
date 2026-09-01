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

// Inverse of libreCycleTargets: given A's BPM fixed, finds the B BPM whose
// resync interval (60/gcd(A,B)) comes closest to a desired number of
// seconds. Not every value is exactly reachable — gcd(A,B) can only be a
// divisor of A — so this is a nearest-fit search over the whole BPM range;
// ties (several B give the same closest seconds) prefer whichever B stays
// nearest to B's current value, so a small edit doesn't jump B far away.
export function pickBpmForSeconds(bpmA, desiredSeconds, currentBpmB, min = 1, max = 600) {
  const a = Math.max(1, Math.round(bpmA));
  const cur = Math.max(1, Math.round(currentBpmB));
  let best = min;
  let bestErr = Infinity;
  for (let b = min; b <= max; b++) {
    const actual = 60 / gcd(a, b);
    const err = Math.abs(actual - desiredSeconds);
    if (err < bestErr - 1e-9 || (err < bestErr + 1e-9 && Math.abs(b - cur) < Math.abs(best - cur))) {
      best = b;
      bestErr = err;
    }
  }
  return best;
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

// Euclidean rhythm E(k,n): distributes k onsets as evenly as possible across
// n slots (Bjorklund's algorithm). Most traditional world rhythms — the
// Cuban tresillo E(3,8), the cinquillo E(5,8), the bossa nova clave E(5,16) —
// are a single (k,n) pair. Returns a boolean array of length n, rotated so
// slot 0 is always an onset. Reference: Toussaint, "The Euclidean Algorithm
// Generates Traditional Musical Rhythms" (2005).
export function euclideanRhythm(k, n) {
  if (n <= 0) return [];
  if (k <= 0) return new Array(n).fill(false);
  if (k >= n) return new Array(n).fill(true);

  const counts = [];
  const remainders = [k];
  let divisor = n - k;
  let level = 0;
  while (true) {
    counts[level] = Math.floor(divisor / remainders[level]);
    remainders[level + 1] = divisor % remainders[level];
    divisor = remainders[level];
    level += 1;
    if (remainders[level] <= 1) break;
  }
  counts[level] = divisor;

  const pattern = [];
  const build = (lvl) => {
    if (lvl === -1) pattern.push(false);
    else if (lvl === -2) pattern.push(true);
    else {
      for (let i = 0; i < counts[lvl]; i++) build(lvl - 1);
      if (remainders[lvl] !== 0) build(lvl - 2);
    }
  };
  build(level);
  const first = pattern.indexOf(true);
  return pattern.slice(first).concat(pattern.slice(0, first));
}

// Accent indices for an additive (aksak) meter — groups like [3,3,2] for an
// 8-pulse cycle grouped 3+3+2 (Balkan/songo), instead of a flat total where
// only pulse 0 is strong. In additive metrics the accent IS the metre: an
// unaccented 8 is indistinguishable from a plain 4/4 (F1-ritmo-metrica.md).
// Returns the Set of pulse indices where a new group starts.
export function accentSet(groups) {
  const accents = new Set();
  let i = 0;
  for (const g of groups) {
    if (g > 0) { accents.add(i); i += g; }
  }
  return accents;
}

// Inverse of accentSet: turns a set of group-start pulse indices back into
// group sizes (e.g. {0,3,6} over 8 -> [3,3,2]), so the UI can let someone
// tap pulses on/off and store the result as groups. An empty or 0-only set
// is a flat meter — one group spanning the whole cycle.
export function groupsFromIndices(indices, total) {
  const sorted = [...indices].filter((i) => i > 0).sort((a, b) => a - b);
  const bounds = [0, ...sorted, total];
  const groups = [];
  for (let i = 0; i < bounds.length - 1; i++) groups.push(bounds[i + 1] - bounds[i]);
  return groups;
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
