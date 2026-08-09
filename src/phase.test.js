import { describe, it, expect } from "vitest";
import {
  gcd, lcm, polyCycleTarget, libreCycleTargets,
  cycleIndex, cycleRemaining, isSyncPulse, derivedBpm,
} from "./phase.js";

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
