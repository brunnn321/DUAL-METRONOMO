import { describe, it, expect } from "vitest";
import {
  gcd, lcm, polyCycleTarget, libreCycleTargets,
  cycleIndex, cycleRemaining, isSyncPulse, derivedBpm, reduceRatio, perceptualBand,
  euclideanRhythm, accentSet, groupsFromIndices,
} from "./phase.js";

const asDots = (pattern) => pattern.map((b) => (b ? "x" : ".")).join("");

describe("gcd / lcm", () => {
  it("computes gcd", () => {
    expect(gcd(90, 91)).toBe(1);
    expect(gcd(90, 120)).toBe(30);
    expect(gcd(12, 12)).toBe(12);
  });
  it("computes lcm", () => {
    expect(lcm(4, 3)).toBe(12);
    expect(lcm(4, 4)).toBe(4);
    expect(lcm(6, 8)).toBe(24);
  });
});

describe("polyCycleTarget", () => {
  it("is the lcm of both beat counts", () => {
    expect(polyCycleTarget(4, 3)).toBe(12);
    expect(polyCycleTarget(5, 4)).toBe(20);
    expect(polyCycleTarget(4, 4)).toBe(4);
  });
  it("never divides by zero on degenerate input", () => {
    expect(polyCycleTarget(0, 3)).toBe(3);
    expect(polyCycleTarget(0, 0)).toBe(1);
  });
});

describe("libreCycleTargets", () => {
  it("matches the 90 vs 91 bpm case: realign after 60s", () => {
    const { targetA, targetB, seconds } = libreCycleTargets(90, 91);
    expect(targetA).toBe(90);
    expect(targetB).toBe(91);
    expect(seconds).toBe(60);
  });
  it("shortens the cycle when the BPMs share a factor", () => {
    const { targetA, targetB, seconds } = libreCycleTargets(90, 120);
    expect(targetA).toBe(3);
    expect(targetB).toBe(4);
    expect(seconds).toBe(2);
  });
  it("treats equal BPMs as realigning every pulse", () => {
    const { targetA, targetB } = libreCycleTargets(100, 100);
    expect(targetA).toBe(1);
    expect(targetB).toBe(1);
  });
});

// Regression guard: pulse 1 is the reference click where A and B start
// aligned, so it must sit AT 12 o'clock (index 0), not one step past it.
describe("cycleIndex", () => {
  it("puts the very first pulse in phase at index 0", () => {
    expect(cycleIndex(1, 12)).toBe(0);
  });
  it("advances one slot per pulse", () => {
    expect(cycleIndex(2, 12)).toBe(1);
    expect(cycleIndex(3, 12)).toBe(2);
  });
  it("is one slot short of closing on the last pulse of the cycle", () => {
    expect(cycleIndex(12, 12)).toBe(11);
  });
  it("returns to 0 exactly on the pulse that lands back in phase", () => {
    expect(cycleIndex(13, 12)).toBe(0);
    expect(cycleIndex(25, 12)).toBe(0);
  });
  it("stays at 0 before playback starts", () => {
    expect(cycleIndex(0, 12)).toBe(0);
  });
});

describe("cycleRemaining", () => {
  it("shows a full cycle before starting and on the first pulse", () => {
    expect(cycleRemaining(0, 12)).toBe(12);
    expect(cycleRemaining(1, 12)).toBe(12);
  });
  it("counts down one per pulse", () => {
    expect(cycleRemaining(2, 12)).toBe(11);
    expect(cycleRemaining(11, 12)).toBe(2);
  });
  it("reads 1 on the pulse right before the sync", () => {
    expect(cycleRemaining(12, 12)).toBe(1);
  });
  it("resets to a full cycle on the sync pulse itself", () => {
    expect(cycleRemaining(13, 12)).toBe(12);
  });
  it("never reports a stale value across many cycles", () => {
    for (let n = 1; n <= 100; n++) {
      const r = cycleRemaining(n, 12);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(12);
    }
  });
});

describe("reduceRatio", () => {
  it("flags a true coprime polyrhythm as-is", () => {
    expect(reduceRatio(5, 4)).toEqual({ num: 5, den: 4, isCoprime: true });
  });
  it("collapses a nested subdivision like 8:4 to 2:1", () => {
    expect(reduceRatio(8, 4)).toEqual({ num: 2, den: 1, isCoprime: false });
  });
  it("collapses 6:4 to the disguised 3:2", () => {
    expect(reduceRatio(6, 4)).toEqual({ num: 3, den: 2, isCoprime: false });
  });
  it("treats equal values as the trivial 1:1", () => {
    expect(reduceRatio(4, 4)).toEqual({ num: 1, den: 1, isCoprime: false });
  });
  it("never divides by zero on degenerate input", () => {
    expect(Number.isFinite(reduceRatio(0, 0).num)).toBe(true);
  });
});

describe("perceptualBand", () => {
  it("calls 3:2 and 4:3 integrable — the fusing polyrhythms", () => {
    expect(perceptualBand(3, 2)).toBe("integrable");
    expect(perceptualBand(4, 3)).toBe("integrable");
  });
  it("calls 5:4 and 7:4 separable", () => {
    expect(perceptualBand(5, 4)).toBe("separable");
    expect(perceptualBand(7, 4)).toBe("separable");
  });
  it("calls 7:5 separable and 11:8 textura — the ear stops integrating", () => {
    expect(perceptualBand(7, 5)).toBe("separable");
    expect(perceptualBand(11, 8)).toBe("textura");
  });
  it("judges by the reduced relation, not the raw inputs", () => {
    // 8:4 reduces to 2:1 (product 2) even though raw product is 32
    expect(perceptualBand(8, 4)).toBe("integrable");
  });
});

// Bjorklund's algorithm — verified against the traditional world rhythms
// tabulated in Toussaint, "The Euclidean Algorithm Generates Traditional
// Musical Rhythms" (2005).
describe("euclideanRhythm", () => {
  it("matches the Cuban tresillo E(3,8)", () => {
    expect(asDots(euclideanRhythm(3, 8))).toBe("x..x..x.");
  });
  it("matches the cinquillo E(5,8)", () => {
    expect(asDots(euclideanRhythm(5, 8))).toBe("x.xx.xx.");
  });
  it("matches the simple hemiola-like E(2,5)", () => {
    expect(asDots(euclideanRhythm(2, 5))).toBe("x.x..");
  });
  it("matches the bossa nova clave E(5,16)", () => {
    expect(asDots(euclideanRhythm(5, 16))).toBe("x..x..x..x..x...");
  });
  it("matches the aksak E(4,9)", () => {
    expect(asDots(euclideanRhythm(4, 9))).toBe("x.x.x.x..");
  });
  it("always starts on an onset (rotated to slot 0)", () => {
    for (let n = 2; n <= 20; n++) for (let k = 1; k < n; k++) {
      expect(euclideanRhythm(k, n)[0]).toBe(true);
    }
  });
  it("always places exactly k onsets in n slots", () => {
    for (let n = 2; n <= 20; n++) for (let k = 1; k < n; k++) {
      const hits = euclideanRhythm(k, n).filter(Boolean).length;
      expect(hits).toBe(k);
    }
  });
  it("handles degenerate input without crashing", () => {
    expect(euclideanRhythm(0, 8).every((b) => b === false)).toBe(true);
    expect(euclideanRhythm(8, 8).every((b) => b === true)).toBe(true);
    expect(euclideanRhythm(3, 0)).toEqual([]);
    expect(euclideanRhythm(-1, 8).every((b) => b === false)).toBe(true);
  });
});

describe("accentSet", () => {
  it("accents every group start in a 3+3+2 songo/Balkan 8", () => {
    expect(accentSet([3, 3, 2])).toEqual(new Set([0, 3, 6]));
  });
  it("matches the Turkish aksak 9 = 2+2+2+3", () => {
    expect(accentSet([2, 2, 2, 3])).toEqual(new Set([0, 2, 4, 6]));
  });
  it("collapses to the classic single downbeat for a flat total", () => {
    expect(accentSet([4])).toEqual(new Set([0]));
  });
  it("handles a 7 grouped 2+2+3", () => {
    expect(accentSet([2, 2, 3])).toEqual(new Set([0, 2, 4]));
  });
  it("returns an empty set for no groups, without crashing", () => {
    expect(accentSet([])).toEqual(new Set());
  });
  it("skips degenerate zero/negative group sizes instead of stalling", () => {
    expect(accentSet([3, 0, 2])).toEqual(new Set([0, 3]));
  });
});

describe("groupsFromIndices", () => {
  it("is the inverse of accentSet for a 3+3+2 songo 8", () => {
    expect(groupsFromIndices(new Set([0, 3, 6]), 8)).toEqual([3, 3, 2]);
  });
  it("is the inverse of accentSet for the aksak 9 = 2+2+2+3", () => {
    expect(groupsFromIndices(new Set([0, 2, 4, 6]), 9)).toEqual([2, 2, 2, 3]);
  });
  it("sorts unordered indices before deriving group sizes", () => {
    expect(groupsFromIndices(new Set([6, 0, 3]), 8)).toEqual([3, 3, 2]);
  });
  it("collapses to a single flat group when only 0 is accented", () => {
    expect(groupsFromIndices(new Set([0]), 5)).toEqual([5]);
  });
  it("falls back to a flat group for an empty index set", () => {
    expect(groupsFromIndices(new Set(), 5)).toEqual([5]);
  });
  it("round-trips through accentSet", () => {
    const groups = [2, 2, 3];
    expect(groupsFromIndices(accentSet(groups), 7)).toEqual(groups);
  });
});

describe("derivedBpm", () => {
  it("matches the classic 3 against 2", () => {
    expect(derivedBpm(120, 2, 3)).toBe(180);
  });
  it("keeps both sides equal on a 1:1 relation", () => {
    expect(derivedBpm(90, 4, 4)).toBe(90);
  });
  it("handles the app's default 5 over 4", () => {
    expect(derivedBpm(90, 4, 5)).toBe(112.5);
  });
  it("handles an extreme relation like 15:2", () => {
    expect(derivedBpm(60, 2, 15)).toBe(450);
  });
  it("applies the half / double switch", () => {
    expect(derivedBpm(120, 2, 3, 0.5)).toBe(90);
    expect(derivedBpm(120, 2, 3, 2)).toBe(360);
  });
  it("never divides by zero on a degenerate base", () => {
    expect(Number.isFinite(derivedBpm(120, 0, 3))).toBe(true);
  });
});

// The Council's invariant sweep: across every BPM and beat count the UI can
// actually produce, the cycle math must stay finite, positive and in range.
describe("invariants across the whole supported range", () => {
  const BEATS = [2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15];

  it("polyCycleTarget is always a positive finite integer", () => {
    for (const a of BEATS) for (const b of BEATS) {
      const t = polyCycleTarget(a, b);
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThan(0);
      expect(Number.isFinite(t)).toBe(true);
    }
  });

  it("libre targets are positive integers for every BPM pair in range", () => {
    for (let a = 1; a <= 600; a += 7) for (let b = 1; b <= 600; b += 13) {
      const { targetA, targetB, seconds } = libreCycleTargets(a, b);
      expect(Number.isInteger(targetA)).toBe(true);
      expect(Number.isInteger(targetB)).toBe(true);
      expect(targetA).toBeGreaterThan(0);
      expect(targetB).toBeGreaterThan(0);
      expect(seconds).toBeGreaterThan(0);
      expect(Number.isFinite(seconds)).toBe(true);
    }
  });

  it("the countdown never leaves [1, target] once running", () => {
    for (const a of BEATS) for (const b of BEATS) {
      const target = polyCycleTarget(a, b);
      for (let pulse = 1; pulse <= target * 3 + 5; pulse++) {
        const r = cycleRemaining(pulse, target);
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(target);
      }
    }
  });

  it("the ring index never leaves [0, target-1]", () => {
    for (const a of BEATS) for (const b of BEATS) {
      const target = polyCycleTarget(a, b);
      for (let pulse = 0; pulse <= target * 2 + 3; pulse++) {
        const i = cycleIndex(pulse, target);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThanOrEqual(target - 1);
      }
    }
  });

  it("fires exactly one sync per full cycle, never more", () => {
    for (const a of BEATS) for (const b of BEATS) {
      const target = polyCycleTarget(a, b);
      let hits = 0;
      for (let pulse = 2; pulse <= target + 1; pulse++) if (isSyncPulse(pulse, target)) hits++;
      expect(hits).toBe(1);
    }
  });

  it("degenerate targets never crash or produce NaN", () => {
    for (const target of [0, -1, undefined, null, NaN]) {
      expect(cycleIndex(5, target)).toBe(0);
      expect(cycleRemaining(5, target)).toBe(0);
      expect(isSyncPulse(5, target)).toBe(false);
    }
  });
});

describe("isSyncPulse", () => {
  it("does not fire on the trivial starting alignment", () => {
    expect(isSyncPulse(1, 12)).toBe(false);
    expect(isSyncPulse(0, 12)).toBe(false);
  });
  it("does not fire mid-cycle", () => {
    expect(isSyncPulse(6, 12)).toBe(false);
    expect(isSyncPulse(12, 12)).toBe(false);
  });
  it("fires exactly on the pulse that lands back in phase", () => {
    expect(isSyncPulse(13, 12)).toBe(true);
    expect(isSyncPulse(25, 12)).toBe(true);
  });
  it("fires once per cycle and no more", () => {
    const hits = [];
    for (let n = 1; n <= 40; n++) if (isSyncPulse(n, 12)) hits.push(n);
    expect(hits).toEqual([13, 25, 37]);
  });
  it("lines up with the 90 vs 91 bpm case", () => {
    const { targetA } = libreCycleTargets(90, 91);
    expect(isSyncPulse(90, targetA)).toBe(false);
    expect(isSyncPulse(91, targetA)).toBe(true);
  });
});
