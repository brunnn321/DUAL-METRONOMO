import { describe, it, expect } from "vitest";
import { computeEnvelope, estimateBpmFromEnvelope, lastStrongOnsetIndex, nextBeatTime } from "./bpmDetector.js";

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
