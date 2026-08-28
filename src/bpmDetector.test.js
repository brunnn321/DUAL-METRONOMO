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

  it("stays accurate when one onset is missing (a dropped clap)", () => {
    const env = syntheticEnvelope(100, frameRate, 500);
    const onsets = detectOnsets(env, frameRate);
    const withoutOne = [...onsets.slice(0, 4), ...onsets.slice(5)]; // drop the 5th onset
    const { bpm, confidence } = estimateBpmFromOnsets(withoutOne, frameRate);
    expect(Math.abs(bpm - 100)).toBeLessThanOrEqual(1);
    expect(confidence).toBeGreaterThan(0.5); // one bad interval among many good ones
  });

  it("recovers the true tempo even when MOST intervals are doubled by missed onsets", () => {
    // Real regression: 6 intervals from a noisy 100 BPM recording, 4 of the
    // 6 doubled by dropped claps — [38,39,80,80,80,81] frames. A plain
    // median lands on ~80 (50 BPM, exactly half) because the doubled gaps
    // are the majority. Period induction should still recover ~100 from the
    // two surviving true-period gaps, since 80/81 are consistent doublings
    // of ~39-40, not evidence of a genuinely slower tempo.
    const onsetIdx = [0, 38, 77, 157, 237, 317, 398];
    const { bpm, confidence } = estimateBpmFromOnsets(onsetIdx, frameRate);
    expect(Math.abs(bpm - 100)).toBeLessThan(5);
    expect(confidence).toBeGreaterThan(0.5);
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

  it("scales confidence down for a small onset count even when those few agree perfectly", () => {
    // Only 3 onsets (2 intervals), both exactly equal — a coincidence at
    // this sample size, not real proof of periodicity. Confidence should
    // be well below what the same perfect agreement would earn with many
    // onsets (see the 100-BPM case above, which reaches 1.0).
    const { confidence } = estimateBpmFromOnsets([0, 40, 80], frameRate);
    expect(confidence).toBeLessThan(0.5);
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
    const env = new Array(300).fill(0); // flat flux: no rises, no onsets to find at all
    const result = estimateTempo(env, frameRate);
    expect(result).toHaveProperty("anchorIdx");
    expect(Number.isFinite(result.anchorIdx)).toBe(true);
  });

  it("caps confidence when there's no onset corroboration at all (autocorrelation alone)", () => {
    // Sustained-tone envelope again: forced onto the autocorrelation-only
    // path. Even if autocorrelation itself reports high confidence, this
    // path has no onset count to back it up and must never look as
    // trustworthy as an onset-corroborated result.
    const env = new Array(300).fill(0); // flat flux: no rises, no onsets to find at all
    const { confidence, method } = estimateTempo(env, frameRate);
    expect(method).toBe("autocorr");
    expect(confidence).toBeLessThanOrEqual(0.5);
  });

  // Seeded, deterministic reproduction of a real regression: a noisy 96 BPM
  // recording (dropped/echoed onsets, timing jitter, background noise) used
  // to come back as 203 BPM at confidence 0.69 — an artifact of the
  // autocorrelation fallback that wasn't even among its own top candidates.
  // The fix: trust the onset reading whenever onsets exist at all, and use
  // autocorrelation only to discount confidence when it disagrees, never to
  // override the number.
  function noisyEnvelope(targetBpm, { durationSec = 7, jitterMs = 25, missProb = 0.25, echoProb = 0.25, noiseFloor = 0.12, ampVar = 0.3, seed = 1 } = {}) {
    let s = seed;
    const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const period = (frameRate * 60) / targetBpm;
    const frames = Math.round((durationSec * 1000) / 15);
    const rms = new Array(frames).fill(0).map(() => noiseFloor * rand());
    let t = 0;
    while (t < frames) {
      const jitter = (rand() - 0.5) * 2 * (jitterMs / 15);
      const idx = Math.round(t + jitter);
      if (idx >= 0 && idx < frames && rand() > missProb) {
        const amp = 0.3 + ampVar * rand();
        rms[idx] = Math.max(rms[idx], amp);
        if (idx + 1 < frames) rms[idx + 1] = Math.max(rms[idx + 1], amp * 0.4);
        if (rand() < echoProb && idx + 3 < frames) rms[idx + 3] = Math.max(rms[idx + 3], amp * (0.5 + 0.3 * rand()));
      }
      t += period;
    }
    return computeEnvelope(rms);
  }

  it("doesn't double the tempo on a noisy recording that used to trigger exactly that (regression)", () => {
    // Was 203 BPM at confidence 0.69 before the onset-vs-autocorrelation
    // redesign; period induction (see inferPeriod) now recovers the true
    // tempo almost exactly and earns that confidence honestly, since it
    // really does explain all 8 onsets as a consistent period this time.
    const env = noisyEnvelope(96, { seed: 193 });
    const { bpm, confidence, method } = estimateTempo(env, frameRate);
    expect(Math.abs(bpm - 96)).toBeLessThanOrEqual(1);
    expect(method).toBe("onsets");
    expect(confidence).toBeGreaterThan(0.9);
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
