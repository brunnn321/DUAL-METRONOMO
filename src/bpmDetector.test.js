import { describe, it, expect } from "vitest";
import {
  computeEnvelope, estimateBpmFromEnvelope, lastStrongOnsetIndex, refineOnsetIndex, nextBeatTime,
  detectOnsets, estimateBpmFromOnsets, estimateTempo,
} from "./bpmDetector.js";

describe("computeEnvelope", () => {
  it("is zero where energy doesn't rise", () => {
    expect(computeEnvelope([0.1, 0.1, 0.1])).toEqual([0, 0, 0]);
  });
  it("rectifies drops in energy to zero", () => {
    expect(computeEnvelope([0.1, 0.05])).toEqual([0, 0]);
  });
  it("keeps the positive jump on a rise", () => {
    const flux = computeEnvelope([0.1, 0.4, 0.1]);
    expect(flux[1]).toBeCloseTo(0.3, 5);
    expect(flux[2]).toBe(0);
  });
});

// Builds a synthetic onset envelope with sharp impulses spaced at the period
// implied by targetBpm, so estimateBpmFromEnvelope can be checked against a
// known ground truth without a real microphone.
function syntheticEnvelope(targetBpm, frameRate, frames = 400) {
  const period = (frameRate * 60) / targetBpm;
  const env = new Array(frames).fill(0);
  for (let t = 0; t < frames; t += period) env[Math.round(t)] = 1;
  return env;
}

describe("estimateBpmFromEnvelope", () => {
  const frameRate = 1000 / 15; // matches bpmDetector's own polling rate

  it.each([60, 100, 140, 180])("recovers a synthetic %d BPM click train", (targetBpm) => {
    const env = syntheticEnvelope(targetBpm, frameRate);
    const { bpm } = estimateBpmFromEnvelope(env, frameRate);
    expect(Math.abs(bpm - targetBpm)).toBeLessThanOrEqual(2);
  });

  it("prefers the musically-common range over an octave-doubled peak", () => {
    // A 96 BPM train also autocorrelates strongly at 48 and 192 (half/double);
    // 96 sits in the 60-200 tie-break band and should win.
    const env = syntheticEnvelope(96, frameRate);
    const { bpm } = estimateBpmFromEnvelope(env, frameRate);
    expect(Math.abs(bpm - 96)).toBeLessThanOrEqual(2);
  });

  it("returns low confidence for a flat/silent envelope instead of a garbage BPM", () => {
    const { confidence } = estimateBpmFromEnvelope(new Array(300).fill(0), frameRate);
    expect(confidence).toBeLessThan(0.1);
  });
});

describe("detectOnsets / estimateBpmFromOnsets", () => {
  const frameRate = 1000 / 15;

  it.each([60, 83, 99, 100, 101, 140, 160, 180])("recovers %d BPM from onset intervals, not autocorrelation", (targetBpm) => {
    // Tolerance of 2, not 1: these single-frame synthetic spikes (isolated
    // between zeros) carry no shape for the parabolic refiner to lean on —
    // a real click's attack spans several frames and refines tighter than
    // this fixture can exercise. ±2 still matches what a single frame of
    // rounding is worth at these lag magnitudes.
    const env = syntheticEnvelope(targetBpm, frameRate);
    const onsets = detectOnsets(env, frameRate);
    const { bpm } = estimateBpmFromOnsets(onsets, frameRate);
    expect(Math.abs(bpm - targetBpm)).toBeLessThanOrEqual(2);
  });

  it("is immune to autocorrelation's half-tempo failure mode", () => {
    // 140 BPM is the exact case that used to come back as 70 before the
    // octave-error fix — onset counting should never have been ambiguous.
    const env = syntheticEnvelope(140, frameRate);
    const onsets = detectOnsets(env, frameRate);
    const { bpm } = estimateBpmFromOnsets(onsets, frameRate);
    expect(Math.round(bpm)).toBe(140);
  });

  it("stays accurate via the median when one onset is missing (a dropped clap)", () => {
    const env = syntheticEnvelope(100, frameRate, 500);
    const onsets = detectOnsets(env, frameRate);
    const withoutOne = [...onsets.slice(0, 4), ...onsets.slice(5)]; // drop the 5th onset
    const { bpm, confidence } = estimateBpmFromOnsets(withoutOne, frameRate);
    expect(Math.abs(bpm - 100)).toBeLessThanOrEqual(1);
    expect(confidence).toBeGreaterThan(0.5); // one bad interval among many good ones
  });

  it("returns null with fewer than 3 onsets — not enough for a median", () => {
    expect(estimateBpmFromOnsets([10, 50], frameRate)).toBeNull();
    expect(estimateBpmFromOnsets([], frameRate)).toBeNull();
  });

  it("merges onsets closer than the fastest plausible tempo into one", () => {
    // Two peaks 3 frames apart is far faster than 240 BPM allows — must be
    // one hit's attack spread across frames, not two separate onsets.
    const env = [0, 0, 1.0, 0.4, 0, 0, 0, 0];
    const onsets = detectOnsets(env, frameRate);
    expect(onsets.length).toBe(1);
  });
});

describe("estimateTempo", () => {
  const frameRate = 1000 / 15;

  it("prefers onset-interval measurement over autocorrelation for a clean click train", () => {
    const env = syntheticEnvelope(101, frameRate);
    const { bpm, anchorIdx } = estimateTempo(env, frameRate);
    expect(Math.abs(bpm - 101)).toBeLessThanOrEqual(1);
    expect(typeof anchorIdx).toBe("number");
  });

  it("falls back to autocorrelation when there aren't enough discrete onsets", () => {
    // A near-flat envelope (sustained tone, no attacks) has no onsets to
    // count — estimateTempo must not throw and must still return a shape
    // with a valid anchorIdx.
    const env = new Array(300).fill(0).map((_, i) => (i % 40 === 0 ? 0.05 : 0));
    const result = estimateTempo(env, frameRate);
    expect(result).toHaveProperty("anchorIdx");
    expect(Number.isFinite(result.anchorIdx)).toBe(true);
  });
});

describe("lastStrongOnsetIndex", () => {
  it("picks the last local peak above half the max, not the global max", () => {
    const env = [0, 1.0, 0, 0, 0.6, 0, 0, 0.3, 0];
    expect(lastStrongOnsetIndex(env)).toBe(4);
  });
  it("falls back to the global peak when nothing else qualifies", () => {
    const env = [0, 0, 0, 0.9, 0, 0];
    expect(lastStrongOnsetIndex(env)).toBe(3);
  });
});

describe("refineOnsetIndex", () => {
  it("leaves a perfectly symmetric peak on its integer index", () => {
    const env = [0, 0.5, 1.0, 0.5, 0];
    expect(refineOnsetIndex(env, 2)).toBeCloseTo(2, 5);
  });
  it("shifts toward the taller neighbor for an asymmetric peak", () => {
    const env = [0, 0.4, 1.0, 0.7, 0];
    const refined = refineOnsetIndex(env, 2);
    expect(refined).toBeGreaterThan(2); // taller shoulder is on the right (0.7 > 0.4)
    expect(refined).toBeLessThan(3);
  });
  it("leaves an edge index untouched — no neighbor to interpolate with", () => {
    const env = [1.0, 0.5, 0.1];
    expect(refineOnsetIndex(env, 0)).toBe(0);
  });
});

describe("nextBeatTime", () => {
  it("lands on a whole multiple of the period from the anchor", () => {
    const t = nextBeatTime(10, 0.5, 12.3);
    expect((t - 10) % 0.5).toBeCloseTo(0, 6);
  });
  it("is always strictly after targetTime plus the minimum lead", () => {
    const t = nextBeatTime(10, 0.5, 12.3, 0.15);
    expect(t).toBeGreaterThanOrEqual(12.3 + 0.15 - 1e-9);
  });
  it("handles the onset having happened at this exact instant", () => {
    const t = nextBeatTime(10, 0.4, 10, 0.15);
    expect(t).toBeCloseTo(10.4, 6);
  });
  it("handles a target far in the past relative to the anchor (anchor after target)", () => {
    const t = nextBeatTime(10, 0.5, 5, 0.15);
    expect(t).toBeGreaterThan(5);
    expect(t).toBeLessThanOrEqual(10.5);
  });
});
