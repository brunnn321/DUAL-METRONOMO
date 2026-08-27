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

// Autocorrelate the envelope over the lag range for MIN_BPM..MAX_BPM, take
// the strongest local peak. Octave-error guard: if the best peak isn't in
// the musically common 60-200 BPM band but a nearly-as-strong one is,
// prefer that one instead (autocorrelation's classic failure mode is
// locking onto a half/double-tempo peak).
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
  const candidates = top.map((p) => ({ bpm: bpmOf(p.lag), score: p.score }));

  let best = candidates[0];
  // Half-tempo lock is autocorrelation's classic failure: a click train at
  // period P also correlates (more weakly) at 2P, but 2P can still end up
  // scoring highest on real/quantized signals. If a candidate at ~2x the
  // current pick's BPM still has substantial support, trust the faster one.
  for (const c of candidates) {
    if (c === best) continue;
    const ratio = c.bpm / best.bpm;
    if (ratio > 1.8 && ratio < 2.2 && c.score >= best.score * 0.55) best = c;
  }
  // Remaining ambiguity: prefer the musically common 60-200 BPM band.
  for (const c of candidates) {
    if (c === best) continue;
    const inRange = (b) => b >= 60 && b <= 200;
    if (!inRange(best.bpm) && inRange(c.bpm) && c.score > best.score * 0.6) best = c;
  }

  const maxScore = Math.max(...scores.map((s) => s.score)) || 1;
  return {
    bpm: Math.round(best.bpm),
    periodSec: 60 / best.bpm, // unrounded — feeds phase alignment
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
