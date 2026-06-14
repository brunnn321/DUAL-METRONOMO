import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Square, Volume2, VolumeX, Save, Trash2 } from "lucide-react";

// ─── constants ────────────────────────────────────────────────────────────────

const TIME_SIGNATURES = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8"];
const beatsPerMeasure = (sig) => parseInt(sig.split("/")[0]);

const STORAGE_KEY = "dual-metronome-presets-v2";

const SOUNDS = [
  { key: "click", label: "CLICK" },
  { key: "beep",  label: "BEEP"  },
  { key: "wood",  label: "WOOD"  },
  { key: "clave", label: "CLAVE" },
  { key: "rim",   label: "RIM"   },
  { key: "hat",   label: "HAT"   },
];

// ─── audio synthesis ──────────────────────────────────────────────────────────

function synthClick(ctx, time, soundKey, volume) {
  if (volume < 0.001) return;

  if (soundKey === "hat") {
    const len = Math.floor(ctx.sampleRate * 0.045);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bpf = ctx.createBiquadFilter();
    bpf.type = "highpass";
    bpf.frequency.value = 6000;
    const gain = ctx.createGain();
    src.connect(bpf);
    bpf.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(volume * 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.start(time);
    return;
  }

  const configs = {
    click: { type: "square",   freq: 900,  decay: 0.065 },
    beep:  { type: "sine",     freq: 660,  decay: 0.14  },
    wood:  { type: "sine",     freq: 280,  decay: 0.055 },
    clave: { type: "sine",     freq: 1500, decay: 0.042 },
    rim:   { type: "triangle", freq: 420,  decay: 0.038 },
  };
  const cfg = configs[soundKey] ?? configs.click;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = cfg.type;
  osc.frequency.setValueAtTime(cfg.freq, time);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(volume * 0.85, time + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, time + cfg.decay);
  osc.start(time);
  osc.stop(time + cfg.decay + 0.01);
}

// ─── sub-components ───────────────────────────────────────────────────────────

function SoundPicker({ label, value, onChange, accent }) {
  return (
    <div>
      <div style={{ color: "#555", fontSize: 9, fontFamily: "monospace", letterSpacing: 1, marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {SOUNDS.map((s) => {
          const active = value === s.key;
          return (
            <button
              key={s.key}
              onClick={() => onChange(s.key)}
              style={{
                background: active ? accent : "#252830",
                border: `1px solid ${active ? accent : "#3a3d47"}`,
                borderRadius: 4, color: active ? "#15171c" : "#666",
                fontFamily: "monospace", fontSize: 9, fontWeight: active ? 700 : 400,
                padding: "3px 6px", cursor: "pointer", letterSpacing: 0.5,
                transition: "all 0.1s",
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MetronomePanel({ color, state, onChange, running, onToggle, measures }) {
  const { bpm, timeSig, volume, muted, beat, strongSound, weakSound } = state;
  const tapTimesRef = useRef([]);
  const accent = color === "A" ? "#ff6b4a" : "#4ad9ff";
  const dimAccent = color === "A" ? "#6a2a18" : "#174d5e";
  const totalBeats = beatsPerMeasure(timeSig);

  const handleTap = () => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    taps.push(now);
    if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const newBpm = Math.round(60000 / avg);
      if (newBpm >= 30 && newBpm <= 300) onChange({ bpm: newBpm });
    }
  };

  return (
    <div style={{
      background: "#1e2028",
      border: `2px solid ${running ? accent + "55" : accent + "1a"}`,
      borderRadius: 12,
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      gap: 14,
      flex: 1,
      minWidth: 270,
      transition: "border-color 0.25s",
    }}>

      {/* ── header: label + individual play button ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          background: accent, color: "#15171c",
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700, fontSize: 12,
          padding: "2px 10px", borderRadius: 4, letterSpacing: 2,
        }}>
          MET {color}
        </span>
        <button
          onClick={onToggle}
          style={{
            background: running ? `${accent}1a` : "#252830",
            border: `1px solid ${running ? accent : "#3a3d47"}`,
            borderRadius: 6, color: running ? accent : "#555",
            padding: "5px 13px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5,
            fontFamily: "monospace", fontSize: 11, fontWeight: 600,
            transition: "all 0.15s",
          }}
        >
          {running ? <Square size={11} /> : <Play size={11} />}
          {running ? "STOP" : "PLAY"}
        </button>
      </div>

      {/* ── BPM display + bar counter ── */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 64, fontWeight: 700,
            color: accent, lineHeight: 1, letterSpacing: -2,
            textShadow: running ? `0 0 24px ${accent}55` : "none",
            transition: "text-shadow 0.3s",
          }}>
            {bpm}
          </div>
          <div style={{ color: "#444", fontSize: 10, marginTop: 2, fontFamily: "monospace" }}>BPM</div>
        </div>

        {/* bar counter display */}
        <div style={{
          background: "#15171c",
          border: `1px solid ${accent}2a`,
          borderRadius: 6, padding: "6px 10px", textAlign: "center", minWidth: 58,
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 20, fontWeight: 700,
            color: running ? accent : "#333",
            lineHeight: 1, transition: "color 0.3s",
          }}>
            {String(measures).padStart(3, "0")}
          </div>
          <div style={{ color: "#444", fontSize: 8, marginTop: 3, fontFamily: "monospace", letterSpacing: 1 }}>BAR</div>
        </div>
      </div>

      {/* ── BPM slider ── */}
      <div>
        <input
          type="range" min={30} max={300} value={bpm}
          onChange={(e) => onChange({ bpm: parseInt(e.target.value) })}
          style={{ width: "100%", accentColor: accent, cursor: "pointer" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", color: "#444", fontSize: 9, fontFamily: "monospace" }}>
          <span>30</span><span>300</span>
        </div>
      </div>

      {/* ── BPM nudge buttons ── */}
      <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
        {[-10, -1, +1, +10].map((d) => (
          <button
            key={d}
            onClick={() => onChange({ bpm: Math.min(300, Math.max(30, bpm + d)) })}
            style={{
              background: "#252830", border: `1px solid ${accent}33`, borderRadius: 5,
              color: accent, fontFamily: "monospace", fontSize: 12, padding: "5px 10px",
              cursor: "pointer",
            }}
          >
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
      </div>

      {/* ── Tap tempo ── */}
      <button
        onClick={handleTap}
        style={{
          background: `${accent}14`, border: `1px solid ${accent}44`, borderRadius: 7,
          color: accent, fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11, fontWeight: 600, padding: "8px", cursor: "pointer", letterSpacing: 1,
        }}
      >
        TAP TEMPO
      </button>

      {/* ── Time signature ── */}
      <div>
        <div style={{ color: "#444", fontSize: 9, fontFamily: "monospace", marginBottom: 6, letterSpacing: 1 }}>COMPÁS</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {TIME_SIGNATURES.map((sig) => (
            <button
              key={sig}
              onClick={() => onChange({ timeSig: sig })}
              style={{
                background: timeSig === sig ? accent : "#252830",
                border: `1px solid ${timeSig === sig ? accent : "#3a3d47"}`,
                borderRadius: 5, color: timeSig === sig ? "#15171c" : "#777",
                fontFamily: "monospace", fontSize: 11, padding: "3px 8px",
                cursor: "pointer", fontWeight: timeSig === sig ? 700 : 400,
              }}
            >
              {sig}
            </button>
          ))}
        </div>
      </div>

      {/* ── Beat LEDs ── */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
        {Array.from({ length: totalBeats }, (_, i) => (
          <div
            key={i}
            style={{
              width: 15, height: 15, borderRadius: "50%",
              background:
                beat === i
                  ? i === 0 ? accent : `${accent}77`
                  : i === 0 ? dimAccent : "#222530",
              boxShadow: beat === i ? `0 0 8px ${accent}` : "none",
              border: `1px solid ${accent}1a`,
              transition: "background 0.04s, box-shadow 0.04s",
            }}
          />
        ))}
      </div>

      {/* ── Sound selection ── */}
      <div style={{
        borderTop: `1px solid ${accent}1a`,
        paddingTop: 12,
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        <div style={{ color: "#444", fontSize: 9, fontFamily: "monospace", letterSpacing: 1 }}>SONIDOS</div>
        <SoundPicker
          label="FUERTE  (beat 1)"
          value={strongSound}
          onChange={(v) => onChange({ strongSound: v })}
          accent={accent}
        />
        <SoundPicker
          label="DÉBIL"
          value={weakSound}
          onChange={(v) => onChange({ weakSound: v })}
          accent={accent}
        />
      </div>

      {/* ── Volume ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={() => onChange({ muted: !muted })}
          style={{ background: "none", border: "none", cursor: "pointer", color: muted ? "#333" : accent, padding: 2 }}
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <input
          type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => onChange({ volume: parseFloat(e.target.value) })}
          style={{ flex: 1, accentColor: accent }}
          disabled={muted}
        />
        <span style={{ color: "#444", fontSize: 9, fontFamily: "monospace", width: 26, textAlign: "right" }}>
          {Math.round(volume * 100)}
        </span>
      </div>
    </div>
  );
}

function DualSwitch({ on, onToggle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ color: "#444", fontSize: 9, fontFamily: "monospace", letterSpacing: 3 }}>DUAL SYNC</div>
      <div
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 14,
          cursor: "pointer", userSelect: "none",
        }}
      >
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: on ? "#333" : "#666", transition: "color 0.2s",
        }}>
          OFF
        </span>

        <div style={{
          width: 76, height: 38, borderRadius: 19,
          background: on ? "#0d2616" : "#1a1c22",
          border: `2px solid ${on ? "#4aff7a" : "#3a3d47"}`,
          position: "relative", transition: "all 0.25s",
          boxShadow: on ? "0 0 18px #4aff7a33" : "none",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 14,
            background: on ? "#4aff7a" : "#3a3d47",
            position: "absolute", top: 3,
            left: on ? 41 : 3,
            transition: "left 0.25s, background 0.25s",
            boxShadow: on ? "0 0 10px #4aff7a88" : "none",
          }} />
        </div>

        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: on ? "#4aff7a" : "#444", transition: "color 0.2s", letterSpacing: 1,
        }}>
          ON
        </span>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function savePresets(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }

// ─── main component ───────────────────────────────────────────────────────────

const DEFAULT_A = { bpm: 120, timeSig: "4/4", volume: 0.7, muted: false, beat: -1, strongSound: "click", weakSound: "beep"  };
const DEFAULT_B = { bpm: 90,  timeSig: "3/4", volume: 0.7, muted: false, beat: -1, strongSound: "click", weakSound: "wood"  };

export default function DualMetronome() {
  const [runningA, setRunningA] = useState(false);
  const [runningB, setRunningB] = useState(false);
  const [dualOn,   setDualOn]   = useState(false);
  const [metA, setMetA] = useState(DEFAULT_A);
  const [metB, setMetB] = useState(DEFAULT_B);
  const [measuresA, setMeasuresA] = useState(0);
  const [measuresB, setMeasuresB] = useState(0);
  const [presets, setPresets] = useState(loadPresets);
  const [presetName, setPresetName] = useState("");

  // stable refs
  const ctxRef       = useRef(null);
  const schedulerRef = useRef(null);
  const runningARef  = useRef(false);
  const runningBRef  = useRef(false);
  const nextARef     = useRef(0);
  const nextBRef     = useRef(0);
  const beatARef     = useRef(0);
  const beatBRef     = useRef(0);
  const metARef      = useRef(metA);
  const metBRef      = useRef(metB);

  useEffect(() => { metARef.current = metA; }, [metA]);
  useEffect(() => { metBRef.current = metB; }, [metB]);

  useEffect(() => () => {
    clearInterval(schedulerRef.current);
    ctxRef.current?.close();
  }, []);

  // ── scheduler (reads only from refs → safe in stale interval) ────────────
  const scheduleBeats = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") return;
    const ahead = ctx.currentTime + 0.1;

    if (runningARef.current) {
      while (nextARef.current < ahead) {
        const { bpm, timeSig, volume, muted, strongSound, weakSound } = metARef.current;
        const total    = beatsPerMeasure(timeSig);
        const beatIdx  = beatARef.current % total;
        const isStrong = beatIdx === 0;
        const t        = nextARef.current;

        if (!muted) {
          synthClick(ctx, t, isStrong ? strongSound : weakSound, isStrong ? volume : volume * 0.55);
        }

        if (isStrong) {
          const bar   = Math.floor(beatARef.current / total) + 1;
          const delay = Math.max(0, (t - ctx.currentTime) * 1000);
          setTimeout(() => setMeasuresA(bar), delay);
        }

        const cb    = beatIdx;
        const delay = Math.max(0, (t - ctx.currentTime) * 1000);
        setTimeout(() => {
          setMetA((p) => ({ ...p, beat: cb }));
          setTimeout(() => setMetA((p) => ({ ...p, beat: -1 })), 75);
        }, delay);

        nextARef.current += 60 / bpm;
        beatARef.current++;
      }
    }

    if (runningBRef.current) {
      while (nextBRef.current < ahead) {
        const { bpm, timeSig, volume, muted, strongSound, weakSound } = metBRef.current;
        const total    = beatsPerMeasure(timeSig);
        const beatIdx  = beatBRef.current % total;
        const isStrong = beatIdx === 0;
        const t        = nextBRef.current;

        if (!muted) {
          synthClick(ctx, t, isStrong ? strongSound : weakSound, isStrong ? volume : volume * 0.55);
        }

        if (isStrong) {
          const bar   = Math.floor(beatBRef.current / total) + 1;
          const delay = Math.max(0, (t - ctx.currentTime) * 1000);
          setTimeout(() => setMeasuresB(bar), delay);
        }

        const cb    = beatIdx;
        const delay = Math.max(0, (t - ctx.currentTime) * 1000);
        setTimeout(() => {
          setMetB((p) => ({ ...p, beat: cb }));
          setTimeout(() => setMetB((p) => ({ ...p, beat: -1 })), 75);
        }, delay);

        nextBRef.current += 60 / bpm;
        beatBRef.current++;
      }
    }
  }, []);

  // ── audio engine helpers ──────────────────────────────────────────────────

  const ensureCtx = () => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  };

  const ensureScheduler = () => {
    if (!schedulerRef.current) {
      scheduleBeats();
      schedulerRef.current = setInterval(scheduleBeats, 25);
    }
  };

  const teardownIfIdle = () => {
    if (!runningARef.current && !runningBRef.current) {
      clearInterval(schedulerRef.current);
      schedulerRef.current = null;
      ctxRef.current?.close();
      ctxRef.current = null;
    }
  };

  const hardStop = () => {
    runningARef.current = false;
    runningBRef.current = false;
    clearInterval(schedulerRef.current);
    schedulerRef.current = null;
    ctxRef.current?.close();
    ctxRef.current = null;
    setRunningA(false);
    setRunningB(false);
    setMetA((p) => ({ ...p, beat: -1 }));
    setMetB((p) => ({ ...p, beat: -1 }));
  };

  // ── individual toggles ────────────────────────────────────────────────────

  const toggleA = () => {
    if (runningARef.current) {
      runningARef.current = false;
      setRunningA(false);
      setMetA((p) => ({ ...p, beat: -1 }));
      setDualOn(false);
      teardownIfIdle();
    } else {
      const ctx = ensureCtx();
      nextARef.current = ctx.currentTime + 0.1;
      beatARef.current = 0;
      setMeasuresA(0);
      runningARef.current = true;
      setRunningA(true);
      setDualOn(false);
      ensureScheduler();
    }
  };

  const toggleB = () => {
    if (runningBRef.current) {
      runningBRef.current = false;
      setRunningB(false);
      setMetB((p) => ({ ...p, beat: -1 }));
      setDualOn(false);
      teardownIfIdle();
    } else {
      const ctx = ensureCtx();
      nextBRef.current = ctx.currentTime + 0.1;
      beatBRef.current = 0;
      setMeasuresB(0);
      runningBRef.current = true;
      setRunningB(true);
      setDualOn(false);
      ensureScheduler();
    }
  };

  // ── dual toggle ───────────────────────────────────────────────────────────

  const toggleDual = () => {
    if (dualOn) {
      hardStop();
      setDualOn(false);
    } else {
      hardStop();
      const ctx      = new AudioContext();
      ctxRef.current = ctx;
      const t0       = ctx.currentTime + 0.1;
      nextARef.current  = t0;
      nextBRef.current  = t0;
      beatARef.current  = 0;
      beatBRef.current  = 0;
      setMeasuresA(0);
      setMeasuresB(0);
      runningARef.current = true;
      runningBRef.current = true;
      setRunningA(true);
      setRunningB(true);
      setDualOn(true);
      scheduleBeats();
      schedulerRef.current = setInterval(scheduleBeats, 25);
    }
  };

  // ── presets ───────────────────────────────────────────────────────────────

  const savePreset = () => {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const entry = {
      id: Date.now(), name,
      a: { bpm: metA.bpm, timeSig: metA.timeSig, strongSound: metA.strongSound, weakSound: metA.weakSound },
      b: { bpm: metB.bpm, timeSig: metB.timeSig, strongSound: metB.strongSound, weakSound: metB.weakSound },
    };
    const updated = [...presets, entry];
    setPresets(updated);
    savePresets(updated);
    setPresetName("");
  };

  const loadPreset = (p) => {
    setMetA((s) => ({ ...s, bpm: p.a.bpm, timeSig: p.a.timeSig, strongSound: p.a.strongSound ?? "click", weakSound: p.a.weakSound ?? "beep" }));
    setMetB((s) => ({ ...s, bpm: p.b.bpm, timeSig: p.b.timeSig, strongSound: p.b.strongSound ?? "click", weakSound: p.b.weakSound ?? "wood" }));
  };

  const deletePreset = (id) => {
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    savePresets(updated);
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: "100vh", background: "#15171c", color: "#ddd",
      fontFamily: "system-ui, sans-serif",
      padding: "28px 16px", boxSizing: "border-box",
    }}>

      {/* header */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <h1 style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 26, fontWeight: 700, color: "#eee",
          margin: 0, letterSpacing: 4,
        }}>
          DUAL <span style={{ color: "#ff6b4a" }}>METRO</span><span style={{ color: "#4ad9ff" }}>NOME</span>
        </h1>
        <p style={{ color: "#444", fontSize: 11, marginTop: 5, fontFamily: "monospace" }}>
          dos tempos. un inicio.
        </p>
      </div>

      {/* panels */}
      <div style={{
        display: "flex", gap: 20, flexWrap: "wrap",
        justifyContent: "center", maxWidth: 860, margin: "0 auto",
      }}>
        <MetronomePanel
          color="A" state={metA}
          onChange={(patch) => setMetA((p) => ({ ...p, ...patch }))}
          running={runningA} onToggle={toggleA} measures={measuresA}
        />
        <MetronomePanel
          color="B" state={metB}
          onChange={(patch) => setMetB((p) => ({ ...p, ...patch }))}
          running={runningB} onToggle={toggleB} measures={measuresB}
        />
      </div>

      {/* dual switch */}
      <div style={{ textAlign: "center", marginTop: 24 }}>
        <DualSwitch on={dualOn} onToggle={toggleDual} />
      </div>

      {/* presets */}
      <div style={{
        maxWidth: 860, margin: "24px auto 0",
        background: "#1e2028", borderRadius: 12, padding: 20,
      }}>
        <div style={{ color: "#444", fontSize: 9, fontFamily: "monospace", marginBottom: 14, letterSpacing: 2 }}>
          PRESETS
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && savePreset()}
            placeholder="Nombre del preset..."
            style={{
              flex: 1, minWidth: 150,
              background: "#252830", border: "1px solid #3a3d47", borderRadius: 6,
              color: "#ddd", fontFamily: "monospace", fontSize: 12, padding: "7px 11px", outline: "none",
            }}
          />
          <button
            onClick={savePreset}
            style={{
              background: "#ff6b4a1a", border: "1px solid #ff6b4a55",
              borderRadius: 6, color: "#ff6b4a", cursor: "pointer",
              padding: "7px 13px", display: "flex", alignItems: "center", gap: 5,
              fontFamily: "monospace", fontSize: 12,
            }}
          >
            <Save size={13} /> Guardar
          </button>
        </div>

        {presets.length === 0 ? (
          <div style={{ color: "#333", fontSize: 11, fontFamily: "monospace", textAlign: "center", padding: 14 }}>
            No hay presets guardados aún.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {presets.map((preset) => (
              <div
                key={preset.id}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "#252830", borderRadius: 7, padding: "9px 12px",
                }}
              >
                <button
                  onClick={() => loadPreset(preset)}
                  style={{
                    flex: 1, background: "none", border: "none", color: "#ddd",
                    fontFamily: "monospace", fontSize: 12, textAlign: "left",
                    cursor: "pointer", padding: 0,
                  }}
                >
                  <span style={{ color: "#666" }}>{preset.name}</span>
                  <span style={{ color: "#ff6b4a", marginLeft: 10 }}>A: {preset.a.bpm} {preset.a.timeSig}</span>
                  <span style={{ color: "#4ad9ff", marginLeft: 10 }}>B: {preset.b.bpm} {preset.b.timeSig}</span>
                </button>
                <button
                  onClick={() => deletePreset(preset.id)}
                  style={{
                    background: "none", border: "none", color: "#444",
                    cursor: "pointer", padding: 3, display: "flex", alignItems: "center",
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
