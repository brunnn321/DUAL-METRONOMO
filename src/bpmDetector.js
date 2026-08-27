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
          const { bpm, periodSec, confidence } = estimateBpmFromEnvelope(envelope, 1000 / FRAME_MS);
          if (!Number.isFinite(bpm) || confidence < MIN_CONFIDENCE) {
            reject(Object.assign(new Error("No se detectó un pulso claro"), { code: "NO_PERIODICITY" }));
            return;
          }
          const anchorIdx = lastStrongOnsetIndex(envelope);
          resolve({ bpm, periodSec, confidence, anchorAt: wallTimes[anchorIdx] });
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
