import { describe, it, expect } from "vitest";
import {
  gcd, lcm, polyCycleTarget, libreCycleTargets,
  cycleIndex, cycleRemaining, isSyncPulse,
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
