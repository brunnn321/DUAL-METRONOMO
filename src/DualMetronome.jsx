import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Square, Volume2, VolumeX, Save, Trash2, ChevronRight } from "lucide-react";

// ─── math ─────────────────────────────────────────────────────────────────────
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a * b) / gcd(a, b);

// ─── constants ────────────────────────────────────────────────────────────────
const TIME_SIGNATURES = [
  "2/4","3/4","4/4","5/4","6/8","7/8","8/8","9/8","11/8","12/8","13/8",
];
const beatsPerMeasure = (sig) => parseInt(sig.split("/")[0]);

const POLY_PRESETS = [
  { label: "2:3",   a: "2/4",  b: "3/4"  },
  { label: "2:4",   a: "2/4",  b: "4/4"  },
  { label: "3:4",   a: "3/4",  b: "4/4"  },
  { label: "3:5",   a: "3/4",  b: "5/4"  },
  { label: "4:5",   a: "4/4",  b: "5/4"  },
  { label: "5:7",   a: "5/4",  b: "7/8"  },
  { label: "7:8",   a: "7/8",  b: "8/8"  },
  { label: "11:13", a: "11/8", b: "13/8" },
];

const SUBDIVISIONS = [
  { key: 1, label: "1/4"  },
  { key: 2, label: "1/8"  },
  { key: 3, label: "Tril" },
  { key: 4, label: "1/16" },
  { key: 5, label: "Qnt"  },
  { key: 6, label: "Sxt"  },
];

const SOUNDS = [
  { key: "click", label: "CLICK" },
  { key: "beep",  label: "BEEP"  },
  { key: "wood",  label: "WOOD"  },
  { key: "clave", label: "CLAVE" },
  { key: "rim",   label: "RIM"   },
  { key: "hat",   label: "HAT"   },
];

const STORAGE_KEY = "dual-metronome-v3";

// ─── audio synthesis ──────────────────────────────────────────────────────────
function synthClick(ctx, time, soundKey, volume) {
  if (volume < 0.001) return;
  if (soundKey === "hat") {
    const len = Math.floor(ctx.sampleRate * 0.045);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = 6000;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(volume * 0.7, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.start(time);
    return;
  }
  const C = { click:["square",900,.065], beep:["sine",660,.14], wood:["sine",280,.055], clave:["sine",1500,.042], rim:["triangle",420,.038] };
  const [type, freq, decay] = C[soundKey] ?? C.click;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.connect(g); g.connect(ctx.destination);
  osc.type = type; osc.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(volume * 0.85, time + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, time + decay);
  osc.start(time); osc.stop(time + decay + 0.01);
}

// ─── circular visualizer ──────────────────────────────────────────────────────
function CircularVisualizer({ metA, metB, runningA, runningB }) {
  const [coincide, setCoincide] = useState(false);
  const coincideRef = useRef(null);

  const totalA = beatsPerMeasure(metA.timeSig);
  const totalB = beatsPerMeasure(metB.timeSig);
  const lcmAB  = lcm(totalA, totalB);
  const CA = "#ff6b4a", CB = "#4ad9ff";
  const S = 280, cx = 140, cy = 140;
  const rA = 110, rB = 72;

  useEffect(() => {
    if (metA.beat === 0 && metB.beat === 0 && (runningA || runningB)) {
      setCoincide(true);
      clearTimeout(coincideRef.current);
      coincideRef.current = setTimeout(() => setCoincide(false), 500);
    }
  }, [metA.beat, metB.beat, runningA, runningB]);

  const ring = (total, r, active, color, dotR) =>
    Array.from({ length: total }, (_, i) => {
      const a = (i / total) * 2 * Math.PI - Math.PI / 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      const on = active === i;
      const accent = i === 0;
      return (
        <g key={i}>
          {on && <circle cx={x} cy={y} r={dotR + 6} fill={`${color}20`} />}
          <circle cx={x} cy={y} r={accent ? dotR + 1 : dotR}
            fill={on ? color : accent ? `${color}55` : `${color}22`}
            style={{ filter: on ? `drop-shadow(0 0 5px ${color})` : "none", transition: "fill 0.05s" }}
          />
        </g>
      );
    });

  const drA = totalA <= 8 ? 7 : totalA <= 12 ? 5 : 4;
  const drB = totalB <= 8 ? 7 : totalB <= 12 ? 5 : 4;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={S} height={S} style={{ overflow: "visible" }}>
        {/* track rings */}
        <circle cx={cx} cy={cy} r={rA} fill="none" stroke={`${CA}18`} strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={rB} fill="none" stroke={`${CB}18`} strokeWidth={1.5} />

        {/* coincidence pulse */}
        {coincide && (
          <>
            <circle cx={cx} cy={cy} r={50} fill="none" stroke="#ffffff22" strokeWidth={2}
              style={{ animation: "none" }} />
            <circle cx={cx} cy={cy} r={30} fill="#ffffff08" />
          </>
        )}

        {/* dots */}
        {ring(totalA, rA, metA.beat, CA, drA)}
        {ring(totalB, rB, metB.beat, CB, drB)}

        {/* center text */}
        <text x={cx} y={cy - 9} textAnchor="middle" fill={coincide ? "#fff" : "#888"}
          fontSize={20} fontFamily="'JetBrains Mono',monospace" fontWeight="700"
          style={{ transition: "fill 0.2s" }}>
          {totalA}:{totalB}
        </text>
        <text x={cx} y={cy + 9} textAnchor="middle" fill="#444"
          fontSize={9} fontFamily="monospace">
          MCM = {lcmAB}
        </text>

        {/* legend */}
        <circle cx={cx - 38} cy={S - 16} r={4} fill={CA} />
        <text x={cx - 30} y={S - 12} fill="#444" fontSize={9} fontFamily="monospace">MET A</text>
        <circle cx={cx + 14} cy={S - 16} r={4} fill={CB} />
        <text x={cx + 22} y={S - 12} fill="#444" fontSize={9} fontFamily="monospace">MET B</text>
      </svg>

      <div style={{ fontFamily: "monospace", fontSize: 11, color: "#555", textAlign: "center" }}>
        Polimetría {totalA} contra {totalB}
        <span style={{ margin: "0 8px", color: "#333" }}>·</span>
        Coinciden cada{" "}
        <span style={{ color: coincide ? "#fff" : "#888", fontWeight: 700, transition: "color 0.2s" }}>
          {lcmAB}
        </span>{" "}
        pulsos
      </div>
    </div>
  );
}

// ─── poly preset buttons ──────────────────────────────────────────────────────
function PolyPresets({ onSelect, active }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: "#444", fontSize: 9, fontFamily: "monospace", letterSpacing: 2, marginBottom: 8 }}>
        PRESETS DE POLIMETRÍA
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
        {POLY_PRESETS.map((p) => {
          const on = active === p.label;
          return (
            <button key={p.label} onClick={() => onSelect(p)} style={{
              background: on ? "#ff6b4a18" : "#1e2028",
              border: `1px solid ${on ? "#ff6b4a" : "#3a3d47"}`,
              borderRadius: 6, color: on ? "#ff6b4a" : "#666",
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 12, fontWeight: on ? 700 : 400,
              padding: "6px 12px", cursor: "pointer", transition: "all 0.15s",
            }}>{p.label}</button>
          );
        })}
      </div>
    </div>
  );
}

// ─── small pickers ────────────────────────────────────────────────────────────
function Picker({ label, items, value, onChange, accent }) {
  return (
    <div>
      <div style={{ color: "#555", fontSize: 9, fontFamily: "monospace", letterSpacing: 1, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {items.map(({ key, label: lbl }) => {
          const on = value === key;
          return (
            <button key={key} onClick={() => onChange(key)} style={{
              background: on ? accent : "#252830",
              border: `1px solid ${on ? accent : "#3a3d47"}`,
              borderRadius: 4, color: on ? "#15171c" : "#666",
              fontFamily: "monospace", fontSize: 9, fontWeight: on ? 700 : 400,
              padding: "3px 6px", cursor: "pointer", transition: "all 0.1s",
            }}>{lbl}</button>
          );
        })}
      </div>
    </div>
  );
}

// ─── metronome panel ──────────────────────────────────────────────────────────
function MetronomePanel({ color, state, onChange, running, onToggle, measures }) {
  const { bpm, timeSig, volume, muted, beat, strongSound, weakSound, subdivision } = state;
  const tapTimesRef = useRef([]);
  const accent    = color === "A" ? "#ff6b4a" : "#4ad9ff";
  const dimAccent = color === "A" ? "#6a2a18" : "#174d5e";
  const total     = beatsPerMeasure(timeSig);

  const handleTap = () => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    taps.push(now);
    if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      const ints = [];
      for (let i = 1; i < taps.length; i++) ints.push(taps[i] - taps[i - 1]);
      const avg = ints.reduce((a, b) => a + b, 0) / ints.length;
      const v = Math.round(60000 / avg);
      if (v >= 30 && v <= 300) onChange({ bpm: v });
    }
  };

  return (
    <div style={{
      background: "#1e2028",
      border: `2px solid ${running ? accent + "55" : accent + "1a"}`,
      borderRadius: 12, padding: "20px",
      display: "flex", flexDirection: "column", gap: 14,
      flex: 1, minWidth: 270, transition: "border-color 0.25s",
    }}>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          background: accent, color: "#15171c",
          fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
          fontSize: 12, padding: "2px 10px", borderRadius: 4, letterSpacing: 2,
        }}>MET {color}</span>
        <button onClick={onToggle} style={{
          background: running ? `${accent}1a` : "#252830",
          border: `1px solid ${running ? accent : "#3a3d47"}`,
          borderRadius: 6, color: running ? accent : "#555",
          padding: "5px 13px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 5,
          fontFamily: "monospace", fontSize: 11, fontWeight: 600, transition: "all 0.15s",
        }}>
          {running ? <Square size={11} /> : <Play size={11} />}
          {running ? "STOP" : "PLAY"}
        </button>
      </div>

      {/* BPM + bar counter */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 64, fontWeight: 700, color: accent,
            lineHeight: 1, letterSpacing: -2,
            textShadow: running ? `0 0 24px ${accent}55` : "none",
            transition: "text-shadow 0.3s",
          }}>{bpm}</div>
          <div style={{ color: "#444", fontSize: 10, marginTop: 2, fontFamily: "monospace" }}>BPM</div>
        </div>
        <div style={{
          background: "#15171c", border: `1px solid ${accent}2a`,
          borderRadius: 6, padding: "6px 10px", textAlign: "center", minWidth: 58,
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700,
            color: running ? accent : "#333", lineHeight: 1, transition: "color 0.3s",
          }}>{String(measures).padStart(3, "0")}</div>
          <div style={{ color: "#444", fontSize: 8, marginTop: 3, fontFamily: "monospace", letterSpacing: 1 }}>BAR</div>
        </div>
      </div>

      {/* slider */}
      <div>
        <input type="range" min={30} max={300} value={bpm}
          onChange={(e) => onChange({ bpm: parseInt(e.target.value) })}
          style={{ width: "100%", accentColor: accent, cursor: "pointer" }} />
        <div style={{ display: "flex", justifyContent: "space-between", color: "#444", fontSize: 9, fontFamily: "monospace" }}>
          <span>30</span><span>300</span>
        </div>
      </div>

      {/* nudge */}
      <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
        {[-10, -1, +1, +10].map((d) => (
          <button key={d}
            onClick={() => onChange({ bpm: Math.min(300, Math.max(30, bpm + d)) })}
            style={{
              background: "#252830", border: `1px solid ${accent}33`, borderRadius: 5,
              color: accent, fontFamily: "monospace", fontSize: 12, padding: "5px 10px", cursor: "pointer",
            }}>{d > 0 ? `+${d}` : d}</button>
        ))}
      </div>

      {/* tap */}
      <button onClick={handleTap} style={{
        background: `${accent}14`, border: `1px solid ${accent}44`, borderRadius: 7,
        color: accent, fontFamily: "'JetBrains Mono',monospace",
        fontSize: 11, fontWeight: 600, padding: "8px", cursor: "pointer", letterSpacing: 1,
      }}>TAP TEMPO</button>

      {/* time sig */}
      <div>
        <div style={{ color: "#444", fontSize: 9, fontFamily: "monospace", marginBottom: 6, letterSpacing: 1 }}>COMPÁS</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {TIME_SIGNATURES.map((sig) => (
            <button key={sig} onClick={() => onChange({ timeSig: sig })} style={{
              background: timeSig === sig ? accent : "#252830",
              border: `1px solid ${timeSig === sig ? accent : "#3a3d47"}`,
              borderRadius: 5, color: timeSig === sig ? "#15171c" : "#777",
              fontFamily: "monospace", fontSize: 11, padding: "3px 8px",
              cursor: "pointer", fontWeight: timeSig === sig ? 700 : 400,
            }}>{sig}</button>
          ))}
        </div>
      </div>

      {/* LEDs */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{
            width: 15, height: 15, borderRadius: "50%",
            background: beat === i ? (i === 0 ? accent : `${accent}77`) : (i === 0 ? dimAccent : "#222530"),
            boxShadow: beat === i ? `0 0 8px ${accent}` : "none",
            border: `1px solid ${accent}1a`,
            transition: "background 0.04s, box-shadow 0.04s",
          }} />
        ))}
      </div>

      {/* sounds + subdivision */}
      <div style={{ borderTop: `1px solid ${accent}1a`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <Picker label="FUERTE (beat 1)" items={SOUNDS} value={strongSound} onChange={(v) => onChange({ strongSound: v })} accent={accent} />
        <Picker label="DÉBIL" items={SOUNDS} value={weakSound} onChange={(v) => onChange({ weakSound: v })} accent={accent} />
        <Picker label="SUBDIVISIÓN" items={SUBDIVISIONS} value={subdivision} onChange={(v) => onChange({ subdivision: v })} accent={accent} />
      </div>

      {/* volume */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => onChange({ muted: !muted })} style={{
          background: "none", border: "none", cursor: "pointer",
          color: muted ? "#333" : accent, padding: 2,
        }}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
        <input type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => onChange({ volume: parseFloat(e.target.value) })}
          style={{ flex: 1, accentColor: accent }} disabled={muted} />
        <span style={{ color: "#444", fontSize: 9, fontFamily: "monospace", width: 26, textAlign: "right" }}>
          {Math.round(volume * 100)}
        </span>
      </div>
    </div>
  );
}

// ─── dual switch ──────────────────────────────────────────────────────────────
function DualSwitch({ on, onToggle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ color: "#444", fontSize: 9, fontFamily: "monospace", letterSpacing: 3 }}>DUAL SYNC</div>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: on ? "#333" : "#666", transition: "color 0.2s" }}>OFF</span>
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
            position: "absolute", top: 3, left: on ? 41 : 3,
            transition: "left 0.25s, background 0.25s",
            boxShadow: on ? "0 0 10px #4aff7a88" : "none",
          }} />
        </div>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: on ? "#4aff7a" : "#444", transition: "color 0.2s", letterSpacing: 1 }}>ON</span>
      </div>
    </div>
  );
}

// ─── progressive practice ─────────────────────────────────────────────────────
function ProgressivePractice({ onBpmChange, onActivate, running }) {
  const [on, setOn]       = useState(false);
  const [cfg, setCfg]     = useState({ bpmStart: 60, bpmMax: 140, increment: 5, intervalSec: 120, onMax: "stop" });
  const [curBpm, setCurBpm]   = useState(60);
  const [timeLeft, setTimeLeft] = useState(120);

  const curBpmRef  = useRef(60);
  const cfgRef     = useRef(cfg);
  const timerRef   = useRef(null);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const start = () => {
    const initial = cfg.bpmStart;
    curBpmRef.current = initial;
    setCurBpm(initial);
    setTimeLeft(cfg.intervalSec);
    onBpmChange(initial);
    onActivate();
    setOn(true);
  };

  const stop = () => { setOn(false); clearInterval(timerRef.current); };

  useEffect(() => {
    if (!on) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t > 1) return t - 1;
        const c = cfgRef.current;
        const next = Math.min(curBpmRef.current + c.increment, c.bpmMax);
        curBpmRef.current = next;
        setCurBpm(next);
        onBpmChange(next);
        if (next >= c.bpmMax) {
          if (c.onMax === "stop")    { stop(); }
          if (c.onMax === "restart") { curBpmRef.current = c.bpmStart; setCurBpm(c.bpmStart); onBpmChange(c.bpmStart); }
        }
        return c.intervalSec;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [on]);

  return (
    <div style={{
      background: "#1e2028", borderRadius: 12, padding: 20,
      border: `1px solid ${on ? "#ffd04a44" : "#252830"}`, transition: "border-color 0.3s",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ color: "#666", fontSize: 10, fontFamily: "monospace", letterSpacing: 2 }}>PRÁCTICA PROGRESIVA</div>
        <button onClick={on ? stop : start} style={{
          background: on ? "#3d2a0d" : "#252830",
          border: `1px solid ${on ? "#ffd04a" : "#3a3d47"}`,
          borderRadius: 6, color: on ? "#ffd04a" : "#666",
          fontFamily: "monospace", fontSize: 11, fontWeight: 600,
          padding: "5px 14px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {on ? <Square size={11} /> : <Play size={11} />}
          {on ? "DETENER" : "INICIAR"}
        </button>
      </div>

      {/* config */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: on ? 14 : 0 }}>
        {[["BPM INICIO","bpmStart",30,280],["BPM MÁX","bpmMax",40,300],["+ BPM","increment",1,20],["SEG / PASO","intervalSec",10,600]].map(([lbl,k,mn,mx]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 80 }}>
            <div style={{ color: "#444", fontSize: 8, fontFamily: "monospace", letterSpacing: 1 }}>{lbl}</div>
            <input type="number" min={mn} max={mx} value={cfg[k]}
              onChange={(e) => set(k, Math.max(mn, parseInt(e.target.value) || mn))}
              disabled={on}
              style={{
                background: "#252830", border: "1px solid #3a3d47", borderRadius: 5,
                color: on ? "#555" : "#ddd", fontFamily: "monospace", fontSize: 13,
                padding: "4px 8px", width: "100%", outline: "none",
              }} />
          </div>
        ))}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 80 }}>
          <div style={{ color: "#444", fontSize: 8, fontFamily: "monospace", letterSpacing: 1 }}>AL LLEGAR AL MÁX</div>
          <select value={cfg.onMax} onChange={(e) => set("onMax", e.target.value)} disabled={on}
            style={{
              background: "#252830", border: "1px solid #3a3d47", borderRadius: 5,
              color: on ? "#555" : "#ddd", fontFamily: "monospace", fontSize: 11,
              padding: "4px 6px", outline: "none", cursor: "pointer",
            }}>
            <option value="stop">Detener</option>
            <option value="hold">Mantener</option>
            <option value="restart">Reiniciar</option>
          </select>
        </div>
      </div>

      {/* active display */}
      {on && (
        <div style={{
          display: "flex", gap: 16, alignItems: "center",
          background: "#15171c", borderRadius: 8, padding: "12px 16px",
          border: "1px solid #ffd04a22",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, color: "#ffd04a", fontWeight: 700, lineHeight: 1 }}>{curBpm}</div>
            <div style={{ color: "#555", fontSize: 8, fontFamily: "monospace", marginTop: 2 }}>BPM ACTUAL</div>
          </div>
          <ChevronRight size={14} color="#333" />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, color: "#666", lineHeight: 1 }}>
              {Math.min(curBpm + cfg.increment, cfg.bpmMax)}
            </div>
            <div style={{ color: "#444", fontSize: 8, fontFamily: "monospace", marginTop: 2 }}>PRÓXIMO</div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700,
              color: timeLeft <= 10 ? "#ff6b4a" : "#ffd04a", lineHeight: 1, transition: "color 0.3s",
            }}>{fmt(timeLeft)}</div>
            <div style={{ color: "#555", fontSize: 8, fontFamily: "monospace", marginTop: 2 }}>PRÓXIMO INCREMENTO</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function loadPresets() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function savePresets(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }

const DEFAULT_A = { bpm: 120, timeSig: "4/4", volume: 0.7, muted: false, beat: -1, strongSound: "click", weakSound: "beep",  subdivision: 1 };
const DEFAULT_B = { bpm: 90,  timeSig: "3/4", volume: 0.7, muted: false, beat: -1, strongSound: "click", weakSound: "wood",  subdivision: 1 };

// ─── main ─────────────────────────────────────────────────────────────────────
export default function DualMetronome() {
  const [runningA, setRunningA] = useState(false);
  const [runningB, setRunningB] = useState(false);
  const [dualOn,   setDualOn]   = useState(false);
  const [metA, setMetA] = useState(DEFAULT_A);
  const [metB, setMetB] = useState(DEFAULT_B);
  const [measuresA, setMeasuresA] = useState(0);
  const [measuresB, setMeasuresB] = useState(0);
  const [presets,   setPresets]   = useState(loadPresets);
  const [presetName, setPresetName] = useState("");
  const [activePolyPreset, setActivePolyPreset] = useState(null);

  const ctxRef       = useRef(null);
  const schedulerRef = useRef(null);
  const runningARef  = useRef(false);
  const runningBRef  = useRef(false);
  const nextARef     = useRef(0);
  const nextBRef     = useRef(0);
  const tickARef     = useRef(0);
  const tickBRef     = useRef(0);
  const metARef      = useRef(metA);
  const metBRef      = useRef(metB);

  useEffect(() => { metARef.current = metA; }, [metA]);
  useEffect(() => { metBRef.current = metB; }, [metB]);
  useEffect(() => () => { clearInterval(schedulerRef.current); ctxRef.current?.close(); }, []);

  // ── scheduler ────────────────────────────────────────────────────────────────
  const scheduleBeats = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") return;
    const ahead = ctx.currentTime + 0.1;

    const scheduleMet = (runningRef, metRef, nextRef, tickRef, setMeasures, setMet) => {
      if (!runningRef.current) return;
      const { bpm, timeSig, volume, muted, strongSound, weakSound, subdivision } = metRef.current;
      const total    = beatsPerMeasure(timeSig);
      const beatInt  = 60 / bpm;
      const subInt   = beatInt / subdivision;

      while (nextRef.current < ahead) {
        const tick     = tickRef.current;
        const subIdx   = tick % subdivision;
        const beatIdx  = Math.floor(tick / subdivision) % total;
        const isMain   = subIdx === 0;
        const isAccent = isMain && beatIdx === 0;
        const t        = nextRef.current;

        if (!muted) {
          if (isAccent)     synthClick(ctx, t, strongSound, volume);
          else if (isMain)  synthClick(ctx, t, weakSound,   volume * 0.55);
          else              synthClick(ctx, t, weakSound,   volume * 0.15);
        }

        if (isAccent) {
          const bar   = Math.floor(tick / (subdivision * total)) + 1;
          const delay = Math.max(0, (t - ctx.currentTime) * 1000);
          setTimeout(() => setMeasures(bar), delay);
        }

        if (isMain) {
          const cb    = beatIdx;
          const delay = Math.max(0, (t - ctx.currentTime) * 1000);
          setTimeout(() => {
            setMet((p) => ({ ...p, beat: cb }));
            setTimeout(() => setMet((p) => ({ ...p, beat: -1 })), 75);
          }, delay);
        }

        nextRef.current += subInt;
        tickRef.current++;
      }
    };

    scheduleMet(runningARef, metARef, nextARef, tickARef, setMeasuresA, setMetA);
    scheduleMet(runningBRef, metBRef, nextBRef, tickBRef, setMeasuresB, setMetB);
  }, []);

  // ── engine ───────────────────────────────────────────────────────────────────
  const ensureCtx = () => {
    if (!ctxRef.current || ctxRef.current.state === "closed") ctxRef.current = new AudioContext();
    return ctxRef.current;
  };
  const ensureScheduler = () => {
    if (!schedulerRef.current) { scheduleBeats(); schedulerRef.current = setInterval(scheduleBeats, 25); }
  };
  const teardownIfIdle = () => {
    if (!runningARef.current && !runningBRef.current) {
      clearInterval(schedulerRef.current); schedulerRef.current = null;
      ctxRef.current?.close(); ctxRef.current = null;
    }
  };
  const hardStop = () => {
    runningARef.current = false; runningBRef.current = false;
    clearInterval(schedulerRef.current); schedulerRef.current = null;
    ctxRef.current?.close(); ctxRef.current = null;
    setRunningA(false); setRunningB(false);
    setMetA((p) => ({ ...p, beat: -1 })); setMetB((p) => ({ ...p, beat: -1 }));
  };
  const startDual = () => {
    const ctx = new AudioContext(); ctxRef.current = ctx;
    const t0 = ctx.currentTime + 0.1;
    nextARef.current = t0; nextBRef.current = t0;
    tickARef.current = 0;  tickBRef.current = 0;
    setMeasuresA(0); setMeasuresB(0);
    runningARef.current = true; runningBRef.current = true;
    setRunningA(true); setRunningB(true); setDualOn(true);
    scheduleBeats(); schedulerRef.current = setInterval(scheduleBeats, 25);
  };

  // ── toggles ──────────────────────────────────────────────────────────────────
  const toggleA = () => {
    if (runningARef.current) {
      runningARef.current = false; setRunningA(false); setDualOn(false);
      setMetA((p) => ({ ...p, beat: -1 })); teardownIfIdle();
    } else {
      const ctx = ensureCtx();
      nextARef.current = ctx.currentTime + 0.1; tickARef.current = 0;
      setMeasuresA(0); runningARef.current = true; setRunningA(true); setDualOn(false);
      ensureScheduler();
    }
  };
  const toggleB = () => {
    if (runningBRef.current) {
      runningBRef.current = false; setRunningB(false); setDualOn(false);
      setMetB((p) => ({ ...p, beat: -1 })); teardownIfIdle();
    } else {
      const ctx = ensureCtx();
      nextBRef.current = ctx.currentTime + 0.1; tickBRef.current = 0;
      setMeasuresB(0); runningBRef.current = true; setRunningB(true); setDualOn(false);
      ensureScheduler();
    }
  };
  const toggleDual = () => { if (dualOn) { hardStop(); setDualOn(false); } else { hardStop(); startDual(); } };

  // ── handlers ─────────────────────────────────────────────────────────────────
  const applyPolyPreset = (p) => {
    setMetA((s) => ({ ...s, timeSig: p.a }));
    setMetB((s) => ({ ...s, timeSig: p.b }));
    setActivePolyPreset(p.label);
  };
  const handlePracticeBpm = (bpm) => {
    setMetA((p) => ({ ...p, bpm })); setMetB((p) => ({ ...p, bpm }));
  };
  const handlePracticeActivate = () => {
    if (!runningARef.current || !runningBRef.current) { hardStop(); startDual(); }
  };

  // ── presets ──────────────────────────────────────────────────────────────────
  const savePreset = () => {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const entry = { id: Date.now(), name,
      a: { bpm: metA.bpm, timeSig: metA.timeSig, strongSound: metA.strongSound, weakSound: metA.weakSound, subdivision: metA.subdivision },
      b: { bpm: metB.bpm, timeSig: metB.timeSig, strongSound: metB.strongSound, weakSound: metB.weakSound, subdivision: metB.subdivision },
    };
    const updated = [...presets, entry];
    setPresets(updated); savePresets(updated); setPresetName("");
  };
  const loadPreset = (p) => {
    setMetA((s) => ({ ...s, ...p.a, strongSound: p.a.strongSound ?? "click", weakSound: p.a.weakSound ?? "beep", subdivision: p.a.subdivision ?? 1 }));
    setMetB((s) => ({ ...s, ...p.b, strongSound: p.b.strongSound ?? "click", weakSound: p.b.weakSound ?? "wood", subdivision: p.b.subdivision ?? 1 }));
  };
  const deletePreset = (id) => { const u = presets.filter((p) => p.id !== id); setPresets(u); savePresets(u); };

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh", background: "#15171c", color: "#ddd",
      fontFamily: "system-ui,sans-serif", padding: "24px 16px", boxSizing: "border-box",
    }}>

      {/* header */}
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <h1 style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 24, fontWeight: 700, color: "#eee", margin: 0, letterSpacing: 4 }}>
          DUAL <span style={{ color: "#ff6b4a" }}>METRO</span><span style={{ color: "#4ad9ff" }}>NOME</span>
        </h1>
      </div>

      {/* poly presets */}
      <div style={{ maxWidth: 880, margin: "0 auto 18px" }}>
        <PolyPresets onSelect={applyPolyPreset} active={activePolyPreset} />
      </div>

      {/* circular visualizer */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
        <CircularVisualizer metA={metA} metB={metB} runningA={runningA} runningB={runningB} />
      </div>

      {/* panels */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center", maxWidth: 880, margin: "0 auto" }}>
        <MetronomePanel color="A" state={metA}
          onChange={(patch) => { setMetA((p) => ({ ...p, ...patch })); setActivePolyPreset(null); }}
          running={runningA} onToggle={toggleA} measures={measuresA} />
        <MetronomePanel color="B" state={metB}
          onChange={(patch) => { setMetB((p) => ({ ...p, ...patch })); setActivePolyPreset(null); }}
          running={runningB} onToggle={toggleB} measures={measuresB} />
      </div>

      {/* dual switch */}
      <div style={{ textAlign: "center", margin: "22px 0" }}>
        <DualSwitch on={dualOn} onToggle={toggleDual} />
      </div>

      {/* progressive practice */}
      <div style={{ maxWidth: 880, margin: "0 auto 18px" }}>
        <ProgressivePractice
          onBpmChange={handlePracticeBpm}
          onActivate={handlePracticeActivate}
          running={runningA && runningB}
        />
      </div>

      {/* presets */}
      <div style={{ maxWidth: 880, margin: "0 auto", background: "#1e2028", borderRadius: 12, padding: 20 }}>
        <div style={{ color: "#444", fontSize: 9, fontFamily: "monospace", marginBottom: 14, letterSpacing: 2 }}>PRESETS</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input value={presetName} onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && savePreset()}
            placeholder="Nombre del preset..."
            style={{
              flex: 1, minWidth: 150, background: "#252830", border: "1px solid #3a3d47",
              borderRadius: 6, color: "#ddd", fontFamily: "monospace", fontSize: 12,
              padding: "7px 11px", outline: "none",
            }} />
          <button onClick={savePreset} style={{
            background: "#ff6b4a1a", border: "1px solid #ff6b4a55",
            borderRadius: 6, color: "#ff6b4a", cursor: "pointer",
            padding: "7px 13px", display: "flex", alignItems: "center", gap: 5,
            fontFamily: "monospace", fontSize: 12,
          }}><Save size={13} /> Guardar</button>
        </div>
        {presets.length === 0 ? (
          <div style={{ color: "#333", fontSize: 11, fontFamily: "monospace", textAlign: "center", padding: 14 }}>
            No hay presets guardados aún.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {presets.map((pr) => (
              <div key={pr.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#252830", borderRadius: 7, padding: "9px 12px" }}>
                <button onClick={() => loadPreset(pr)} style={{
                  flex: 1, background: "none", border: "none", color: "#ddd",
                  fontFamily: "monospace", fontSize: 12, textAlign: "left", cursor: "pointer", padding: 0,
                }}>
                  <span style={{ color: "#666" }}>{pr.name}</span>
                  <span style={{ color: "#ff6b4a", marginLeft: 10 }}>A: {pr.a.bpm} {pr.a.timeSig}</span>
                  <span style={{ color: "#4ad9ff", marginLeft: 10 }}>B: {pr.b.bpm} {pr.b.timeSig}</span>
                </button>
                <button onClick={() => deletePreset(pr.id)} style={{
                  background: "none", border: "none", color: "#444",
                  cursor: "pointer", padding: 3, display: "flex", alignItems: "center",
                }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
