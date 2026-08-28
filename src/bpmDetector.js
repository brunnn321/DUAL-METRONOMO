// Live tempo detection from the microphone. Pure math (testable, no DOM) is
// separated from the impure mic-capture part, same split as phase.js keeps
// between cycle math and the React-facing scheduler.

const FRAME_MS = 15; // ~66.7 Hz envelope sampling rate
const MIN_BPM = 40, MAX_BPM = 240;
const MIN_CONFIDENCE = 0.15; // below this, treat the recording as "no clear pulse"

// Onset-strength envelope: half-wave-rectified energy flux (positive jumps
// in RMS between consecutive frames) — this responds to attacks/hits
// instead of sustained tone, so a held note doesn't win the autocorrelation
// the way raw energy would.
export function computeEnvelope(rmsFrames) {
  const flux = [0];
  for (let i = 1; i < rmsFrames.length; i++) flux.push(Math.max(0, rmsFrames[i] - rmsFrames[i - 1]));
  return flux;
}

function autocorr(x, lag) {
  let sum = 0;
  const n = x.length - lag;
  for (let i = 0; i < n; i++) sum += x[i] * x[i + lag];
  return sum / n;
}

// Autocorrelate the envelope over the lag range for MIN_BPM..MAX_BPM.
//
// Raw autocorrelation's classic failure is locking onto a sub-harmonic: a
// click train at the true period P also correlates at 2P and 3P (weaker,
// fewer pairs), but on real (non-ideal, quantized) clicks 2P regularly
// scores *higher* than P itself and wins outright — confirmed both by the
// synthetic tests below and by real mic recordings (a clean external
// metronome at 100 BPM was first mis-read as ~53, almost exactly half).
//
// Fix: whenever the winning peak has a candidate at roughly half its own
// lag (i.e. double its BPM) with comparable support, that faster candidate
// is the more likely true period — a real period P always also correlates
// at 2P, so 2P alone is never enough evidence to rule out P. Checked
// directly against autocorr(lag/2), not just against whatever else made
// the top-N peak list, so it can't be missed by unlucky peak-picking.
export function estimateBpmFromEnvelope(envelope, frameRate, { minBpm = MIN_BPM, maxBpm = MAX_BPM } = {}) {
  const lagMin = Math.max(1, Math.round((frameRate * 60) / maxBpm));
  const lagMax = Math.min(envelope.length - 1, Math.round((frameRate * 60) / minBpm));
  const scores = [];
  for (let lag = lagMin; lag <= lagMax; lag++) scores.push({ lag, score: autocorr(envelope, lag) });

  const peaks = [];
  for (let i = 1; i < scores.length - 1; i++) {
    if (scores[i].score > scores[i - 1].score && scores[i].score >= scores[i + 1].score) peaks.push(scores[i]);
  }
  const ranked = (peaks.length ? peaks : scores).slice().sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 5);
  const bpmOf = (lag) => (frameRate * 60) / lag;
  const candidates = top.map((p) => ({ bpm: bpmOf(p.lag), lag: p.lag, score: p.score }));

  let best = candidates[0];
  // Prefer a double-speed (then quadruple-speed) candidate near best.lag/2
  // whenever it still has real support. Lags are derived from the ORIGINAL
  // peak's lag divided by 2^step, not by repeatedly halving an already-
  // rounded value — chained rounding drifts off the true lag by enough
  // frames to land on the wrong BPM entirely at these small magnitudes.
  // Each candidate lag is refined to the strongest of its ±1 neighbors
  // since dividing by a power of two rarely lands exactly on an integer.
  const originLag = best.lag;
  for (let step = 1; step <= 2; step++) {
    const target = Math.round(originLag / 2 ** step);
    if (target < lagMin) break;
    let cand = { lag: target, score: autocorr(envelope, target) };
    for (let l = Math.max(lagMin, target - 1); l <= target + 1; l++) {
      const s = autocorr(envelope, l);
      if (s > cand.score) cand = { lag: l, score: s };
    }
    if (cand.score >= best.score * 0.45) best = { bpm: bpmOf(cand.lag), lag: cand.lag, score: cand.score };
    else break;
  }
  // Remaining ambiguity: prefer the musically common 60-200 BPM band.
  // Rounds before comparing — bpmOf() lands a hair outside 60/200 from pure
  // float error often enough to matter (e.g. exactly-integer periods).
  const inRange = (b) => Math.round(b) >= 60 && Math.round(b) <= 200;
  for (const c of candidates) {
    if (c === best) continue;
    if (!inRange(best.bpm) && inRange(c.bpm) && c.score > best.score * 0.6) best = c;
  }

  // Sub-frame refinement: the envelope only has one sample per FRAME_MS, so
  // the true peak almost never sits exactly on an integer lag — at 100 BPM
  // one frame of rounding error alone is worth ~2-3 BPM. Parabolic
  // interpolation over the winning lag's immediate neighbors estimates
  // where between the frames the real peak falls, well beyond what the
  // sampling rate could otherwise resolve.
  const y0 = autocorr(envelope, Math.max(lagMin, best.lag - 1));
  const y1 = best.score;
  const y2 = autocorr(envelope, best.lag + 1);
  const denom = y0 - 2 * y1 + y2;
  const refinedLag = Math.abs(denom) > 1e-12 ? best.lag + 0.5 * (y0 - y2) / denom : best.lag;
  const refinedBpm = bpmOf(refinedLag);

  const maxScore = Math.max(...scores.map((s) => s.score)) || 1;
  return {
    bpm: Math.round(refinedBpm),
    periodSec: 60 / refinedBpm, // unrounded — feeds phase alignment
    confidence: best.score / maxScore,
    top: candidates.map((c) => ({ bpm: Math.round(c.bpm), score: c.score, rel: c.score / maxScore })),
  };
}

// Detects individual onset peaks (claps/clicks) instead of searching for a
// repeating period over the whole window. For a clean discrete source (an
// external metronome, claps) this sidesteps autocorrelation's structural
// weakness entirely: autocorrelation asks "what period best explains the
// WHOLE window", which a half-tempo or unrelated period can answer better
// than the true one on real (non-ideal) audio. Measuring actual onset-to-
// onset time is a direct measurement, not a search — there's no "candidate
// period" to get wrong.
//
// minGapFrames enforces the fastest plausible tempo (MAX_BPM) as a
// refractory window, so one loud hit's decay tail can't be double-counted
// as two onsets; when a peak lands inside another's refractory window the
// stronger of the two wins.
export function detectOnsets(envelope, frameRate, { threshold = 0.35 } = {}) {
  const maxFlux = Math.max(...envelope) || 0;
  if (maxFlux <= 0) return [];
  const minGapFrames = Math.max(1, Math.round((frameRate * 60) / MAX_BPM));
  const idx = [];
  for (let i = 1; i < envelope.length - 1; i++) {
    if (envelope[i] < maxFlux * threshold) continue;
    if (!(envelope[i] >= envelope[i - 1] && envelope[i] >= envelope[i + 1])) continue;
    const prev = idx[idx.length - 1];
    if (prev !== undefined && i - prev < minGapFrames) {
      if (envelope[i] > envelope[prev]) idx[idx.length - 1] = i;
      continue;
    }
    idx.push(i);
  }
  return idx.map((i) => refineOnsetIndex(envelope, i));
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Tempo from the median inter-onset interval — median (not mean) so one
// missed or extra onset in the window is an outlier that gets ignored
// instead of skewing the estimate. Needs at least 3 onsets (2 intervals) to
// say anything; returns null otherwise so the caller can fall back to
// estimateBpmFromEnvelope for non-percussive input (singing, sustained
// tones) where discrete onsets don't apply.
export function estimateBpmFromOnsets(onsetIdx, frameRate) {
  if (onsetIdx.length < 3) return null;
  const iois = [];
  for (let i = 1; i < onsetIdx.length; i++) iois.push(onsetIdx[i] - onsetIdx[i - 1]);
  const medLag = median(iois);
  if (medLag <= 0) return null;
  const consistent = iois.filter((x) => Math.abs(x - medLag) <= medLag * 0.15).length;
  const bpm = (frameRate * 60) / medLag;
  // A handful of intervals can look perfectly "consistent" by pure chance —
  // 2 out of 2 matching means nothing the way 9 out of 10 does. Scale the
  // reported confidence down for small samples (full weight only from 6
  // onsets / 5 intervals up) so a short, sparse recording doesn't come back
  // as falsely certain.
  const sampleFactor = Math.min(1, (onsetIdx.length - 1) / 5);
  return {
    bpm,
    periodSec: medLag / frameRate,
    confidence: (consistent / iois.length) * sampleFactor,
    lastOnsetIdx: onsetIdx[onsetIdx.length - 1],
  };
}

// Index of the last strong onset (local peak at or above half the envelope's
// max) — the anchor closest to "now" so extrapolating forward to the next
// beat accumulates as little drift as possible. Falls back to the global
// peak if nothing qualifies as a local max.
export function lastStrongOnsetIndex(envelope) {
  const maxFlux = Math.max(...envelope) || 0;
  for (let i = envelope.length - 2; i >= 1; i--) {
    if (envelope[i] >= maxFlux * 0.5 && envelope[i] >= envelope[i - 1] && envelope[i] >= envelope[i + 1]) return i;
  }
  let maxIdx = 0;
  for (let i = 1; i < envelope.length; i++) if (envelope[i] > envelope[maxIdx]) maxIdx = i;
  return maxIdx;
}

// Sub-frame refinement of an onset index, same parabolic-interpolation idea
// as estimateBpmFromEnvelope's lag refinement: one envelope sample per
// FRAME_MS is coarse (15ms of pure quantization error on the phase anchor),
// so fit the true peak's fractional position between the neighboring frames
// instead of trusting the integer index alone. Returns a fractional index.
export function refineOnsetIndex(envelope, idx) {
  if (idx <= 0 || idx >= envelope.length - 1) return idx;
  const y0 = envelope[idx - 1], y1 = envelope[idx], y2 = envelope[idx + 1];
  const denom = y0 - 2 * y1 + y2;
  if (Math.abs(denom) < 1e-12) return idx;
  const delta = 0.5 * (y0 - y2) / denom;
  return Math.abs(delta) <= 1 ? idx + delta : idx; // discard implausible fits
}

// Picks the best tempo estimate for a recorded envelope: onset-interval
// measurement (direct time-between-hits, no period-search ambiguity) is
// trusted whenever there are enough discrete onsets to measure at all — the
// right fit for a metronome, claps, drum hits. Autocorrelation only takes
// over when onsets can't be counted at all (<3 — sustained tone, legato,
// singing, nothing percussive to find).
//
// Autocorrelation is NOT used as a fallback when onset confidence is merely
// low: stress-testing against noisy synthetic recordings showed that in
// exactly the marginal-confidence band, autocorrelation is *less* reliable
// than the onset reading it would replace (one run: onsets read 93 BPM
// against a true 96 at confidence 0.57 — a good answer just under the old
// 0.6 cutoff — while autocorrelation's "fallback" answer for the same
// recording was 203, an artifact of the octave-correction step, not even
// among its own top candidates). Instead, autocorrelation is used only as a
// corroboration signal: if it disagrees with the onset reading (accounting
// for autocorrelation's own octave ambiguity — checked at bpm, 2x and 0.5x),
// that's real uncertainty and the onset confidence is discounted, but the
// onset-measured number itself is still reported and still the more likely
// correct one.
export function estimateTempo(envelope, frameRate) {
  const onsets = detectOnsets(envelope, frameRate);
  const fromOnsets = estimateBpmFromOnsets(onsets, frameRate);

  if (!fromOnsets) {
    // No corroborating onset count at all — autocorrelation is on its own
    // here, and it's demonstrably the less reliable method (see above).
    // Cap the confidence it's allowed to report so this path can never look
    // as trustworthy as an onset-corroborated result.
    const fromAutocorr = estimateBpmFromEnvelope(envelope, frameRate);
    const anchorIdx = refineOnsetIndex(envelope, lastStrongOnsetIndex(envelope));
    return { ...fromAutocorr, confidence: Math.min(fromAutocorr.confidence, 0.5), anchorIdx, method: "autocorr", onsetCount: onsets.length };
  }

  const fromAutocorr = estimateBpmFromEnvelope(envelope, frameRate);
  const ratio = fromAutocorr.bpm / fromOnsets.bpm;
  const corroborated = [0.5, 1, 2].some((k) => Math.abs(ratio - k) / k < 0.06);
  const confidence = corroborated ? fromOnsets.confidence : fromOnsets.confidence * 0.5;

  return {
    bpm: Math.round(fromOnsets.bpm),
    periodSec: fromOnsets.periodSec,
    confidence,
    anchorIdx: fromOnsets.lastOnsetIdx,
    method: "onsets",
    onsetCount: onsets.length,
  };
}

// Next strictly-future instant (relative to targetTime, with a minimum lead
// so it can actually be scheduled) at which a beat would land, extrapolating
// forward from the anchor onset by whole periods. All three times share one
// clock — the caller is responsible for converting the mic-capture anchor
// and the playback AudioContext's clock onto that shared clock first (they
// are different AudioContexts with independent time origins).
export function nextBeatTime(anchorTime, periodSec, targetTime, minLeadSec = 0.15) {
  const elapsed = targetTime - anchorTime;
  let k = Math.ceil((elapsed + minLeadSec) / periodSec);
  if (k < 1) k = 1;
  return anchorTime + k * periodSec;
}

// Records ~durationMs of mic audio and estimates its tempo. Resolves with
// `anchorAt` in performance.now() terms (not the capture AudioContext's
// currentTime — that context is closed immediately after and its clock is
// meaningless to the caller). The caller converts anchorAt onto its own
// playback AudioContext's clock before calling nextBeatTime.
export function recordAndDetectBpm({ durationMs = 7000, onLevel } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.reject(Object.assign(new Error("getUserMedia no soportado"), { code: "UNSUPPORTED" }));
  }
  return navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (stream) =>
      new Promise((resolve, reject) => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const rmsFrames = [];
        const wallTimes = [];
        const start = performance.now();

        const finish = () => {
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
          const envelope = computeEnvelope(rmsFrames);
          // setTimeout(poll, FRAME_MS) never fires at exactly FRAME_MS — event
          // loop/main-thread overhead pushes the real interval a bit longer,
          // which silently squeezes more real time into fewer counted frames
          // and reads the tempo as faster than it is (a consistent few-%
          // overestimate, confirmed against real recordings). Measure the
          // actual frame rate from the wall-clock timestamps instead of
          // trusting the requested interval.
          const measuredFrameRate = wallTimes.length > 1
            ? (1000 * (wallTimes.length - 1)) / (wallTimes[wallTimes.length - 1] - wallTimes[0])
            : 1000 / FRAME_MS;
          const { bpm, periodSec, confidence, anchorIdx, method, onsetCount } = estimateTempo(envelope, measuredFrameRate);
          if (!Number.isFinite(bpm) || confidence < MIN_CONFIDENCE) {
            reject(Object.assign(new Error("No se detectó un pulso claro"), { code: "NO_PERIODICITY" }));
            return;
          }
          const lo = Math.floor(anchorIdx), frac = anchorIdx - lo;
          const anchorAt = lo + 1 < wallTimes.length
            ? wallTimes[lo] + frac * (wallTimes[lo + 1] - wallTimes[lo])
            : wallTimes[Math.round(anchorIdx)];
          resolve({ bpm, periodSec, confidence, anchorAt, method, onsetCount, measuredFrameRate });
        };

        const poll = () => {
          analyser.getFloatTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
          rmsFrames.push(Math.sqrt(sumSq / buf.length));
          wallTimes.push(performance.now());
          if (onLevel) onLevel(rmsFrames[rmsFrames.length - 1]);
          if (performance.now() - start < durationMs) setTimeout(poll, FRAME_MS);
          else finish();
        };
        poll();
      }),
    (err) => {
      const name = err && err.name;
      const code =
        name === "NotFoundError" || name === "DevicesNotFoundError" ? "NO_DEVICE" :
        name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError" ? "PERMISSION_DENIED" :
        "UNSUPPORTED";
      return Promise.reject(Object.assign(new Error((err && err.message) || "No se pudo acceder al micrófono"), { code }));
    }
  );
}
