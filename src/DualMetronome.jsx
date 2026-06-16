import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Square, Volume2, VolumeX, Save, Trash2, ChevronRight, Lightbulb } from "lucide-react";

// ─── math ─────────────────────────────────────────────────────────────────────
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a * b) / gcd(a, b);

// ─── constants ────────────────────────────────────────────────────────────────
const TIME_SIGNATURES = ["2/4","3/4","4/4","5/4","6/8","7/8","8/8","9/8","11/8","12/8","13/8"];
const beatsPerMeasure = (sig) => parseInt(sig.split("/")[0]);

const POLY_PRESETS = [
  { label:"2:3", a:"2/4", b:"3/4" }, { label:"2:4", a:"2/4", b:"4/4" },
  { label:"3:4", a:"3/4", b:"4/4" }, { label:"3:5", a:"3/4", b:"5/4" },
  { label:"4:5", a:"4/4", b:"5/4" }, { label:"5:7", a:"5/4", b:"7/8" },
  { label:"7:8", a:"7/8", b:"8/8" }, { label:"11:13", a:"11/8", b:"13/8" },
];

const SUBDIVISIONS = [
  { key:1, label:"1/4" }, { key:2, label:"1/8" }, { key:3, label:"Tril" },
  { key:4, label:"1/16" }, { key:5, label:"Qnt" }, { key:6, label:"Sxt" },
];

const SOUNDS = [
  { key:"click", label:"CLICK" }, { key:"beep",  label:"BEEP"  },
  { key:"wood",  label:"WOOD"  }, { key:"clave", label:"CLAVE" },
  { key:"rim",   label:"RIM"   }, { key:"hat",   label:"HAT"   },
];

const BASE_VALUES     = [2, 3, 4, 5, 6, 7, 8];
const DERIVADO_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15];

const POLY_NAMES = {
  "3:2":  { name:"Tresillo",     cat:"Polirritmia" },
  "2:3":  { name:"Tresillo",     cat:"Polirritmia" },
  "4:3":  { name:"4 contra 3",   cat:"Polirritmia" },
  "3:4":  { name:"4 contra 3",   cat:"Polirritmia" },
  "5:4":  { name:"Quintillo",    cat:"Polirritmia" },
  "4:5":  { name:"Quintillo",    cat:"Polirritmia" },
  "7:4":  { name:"Septillo",     cat:"Polirritmia" },
  "4:7":  { name:"Septillo",     cat:"Polirritmia" },
  "9:8":  { name:"Nonillo",      cat:"Polirritmia" },
  "8:9":  { name:"Nonillo",      cat:"Polirritmia" },
  "15:8": { name:"Quindecillo",  cat:"Polirritmia" },
  "8:15": { name:"Quindecillo",  cat:"Polirritmia" },
};
const getPolyInfo = (a, b) =>
  POLY_NAMES[`${a}:${b}`] ?? POLY_NAMES[`${b}:${a}`] ?? { name:"Relación personalizada", cat:"Polirritmia" };

const STORAGE_KEY = "dual-metronomo-v3";
// params that require a scheduler restart to stay in sync
const NEEDS_RESTART = new Set(["bpm", "timeSig", "subdivision"]);

// ─── audio ────────────────────────────────────────────────────────────────────
function synthClick(ctx, time, soundKey, volume) {
  if (volume < 0.001) return;
  if (soundKey === "hat") {
    const len = Math.floor(ctx.sampleRate * 0.045);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6000;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(volume * 0.7, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.start(time); return;
  }
  const C = { click:["square",900,.065], beep:["sine",660,.14], wood:["sine",280,.055], clave:["sine",1500,.042], rim:["triangle",420,.038] };
  const [type, freq, decay] = C[soundKey] ?? C.click;
  const osc = ctx.createOscillator(); const g = ctx.createGain();
  osc.connect(g); g.connect(ctx.destination);
  osc.type = type; osc.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(volume * 0.85, time + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, time + decay);
  osc.start(time); osc.stop(time + decay + 0.01);
}

// ─── mode selector ────────────────────────────────────────────────────────────
function ModeSelector({ mode, setMode }) {
  return (
    <div style={{ display:"flex", background:"#1a1c22", borderRadius:8, padding:3, maxWidth:340, margin:"0 auto", gap:2 }}>
      {[["metrica","DUAL SINC"],["libre","DUAL LIBRE"]].map(([k, lbl]) => {
        const on = mode === k;
        return (
          <button key={k} onClick={() => setMode(k)} style={{
            flex:1, background: on ? "#252830" : "none",
            border:`1px solid ${on ? "#3a3d47" : "transparent"}`,
            borderRadius:6, color: on ? "#ddd" : "#444",
            fontFamily:"'JetBrains Mono',monospace", fontSize:10,
            fontWeight: on ? 600 : 400, padding:"8px 10px",
            cursor:"pointer", letterSpacing:0.5, transition:"all 0.15s",
          }}>{lbl}</button>
        );
      })}
    </div>
  );
}

// ─── circular visualizer ──────────────────────────────────────────────────────
function CircularVisualizer({ metA, metB, runningA, runningB, centerLabel, showSubtitle }) {
  const [coincide, setCoincide] = useState(false);
  const tRef = useRef(null);
  const totalA = beatsPerMeasure(metA.timeSig);
  const totalB = beatsPerMeasure(metB.timeSig);
  const lcmAB  = lcm(totalA, totalB);
  const CA = "#ff6b4a", CB = "#4ad9ff";
  const S = 260, cx = 130, cy = 130, rA = 100, rB = 64;

  useEffect(() => {
    if (metA.beat === 0 && metB.beat === 0 && (runningA || runningB)) {
      setCoincide(true);
      clearTimeout(tRef.current);
      tRef.current = setTimeout(() => setCoincide(false), 500);
    }
  }, [metA.beat, metB.beat, runningA, runningB]);

  const ring = (total, r, activeBeat, color) => {
    const dr = total <= 8 ? 9 : total <= 12 ? 7 : 6;
    return Array.from({ length:total }, (_, i) => {
      const a = (i / total) * 2 * Math.PI - Math.PI / 2;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      const on = activeBeat === i;
      return (
        <g key={i}>
          {on && <circle cx={x} cy={y} r={dr+10} fill={`${color}33`} />}
          <circle cx={x} cy={y} r={i === 0 ? dr+2 : dr}
            fill={on ? color : i === 0 ? `${color}cc` : `${color}77`}
            stroke={on ? "#fff" : "none"} strokeWidth={on ? 1.5 : 0}
            style={{ filter: on ? `drop-shadow(0 0 12px ${color}) drop-shadow(0 0 4px #fff)` : "none", transition:"fill 0.05s" }} />
        </g>
      );
    });
  };

  const label = centerLabel ?? `${totalA}:${totalB}`;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
      <svg width={S} height={S} style={{ overflow:"visible" }}>
        <circle cx={cx} cy={cy} r={rA} fill="none" stroke={`${CA}55`} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={rB} fill="none" stroke={`${CB}55`} strokeWidth={2} />
        {coincide && <circle cx={cx} cy={cy} r={42} fill="#ffffff10" stroke="#ffffff55" strokeWidth={2} />}
        {ring(totalA, rA, metA.beat, CA)}
        {ring(totalB, rB, metB.beat, CB)}
        <text x={cx} y={cy-8} textAnchor="middle"
          fill={coincide ? "#fff" : "#bbb"} fontSize={20}
          fontFamily="'JetBrains Mono',monospace" fontWeight="700"
          style={{ transition:"fill 0.2s" }}>{label}</text>
        <text x={cx} y={cy+9} textAnchor="middle" fill="#888" fontSize={9} fontFamily="monospace">
          MCM = {lcmAB}
        </text>
        <circle cx={cx-36} cy={S-14} r={4} fill={CA} />
        <text x={cx-28} y={S-10} fill="#aaa" fontSize={9} fontFamily="monospace">MET A</text>
        <circle cx={cx+14} cy={S-14} r={4} fill={CB} />
        <text x={cx+22} y={S-10} fill="#aaa" fontSize={9} fontFamily="monospace">MET B</text>
      </svg>
      {showSubtitle !== false && (
        <div style={{ fontFamily:"monospace", fontSize:11, color:"#777", textAlign:"center" }}>
          Polimetría {totalA} contra {totalB}
          <span style={{ margin:"0 8px", color:"#444" }}>·</span>
          Coinciden cada{" "}
          <span style={{ color: coincide ? "#fff" : "#ccc", fontWeight:700, transition:"color 0.2s" }}>{lcmAB}</span> pulsos
        </div>
      )}
    </div>
  );
}

// ─── polimetría panel ─────────────────────────────────────────────────────────
function PoliPanel({ bpmBase, base, derivado, onBpmBase, onBase, onDeriv }) {
  const ratio  = `${derivado}:${base}`;
  const bpmB   = bpmBase * derivado / base;
  const poly   = getPolyInfo(derivado, base);
  const lcmAB  = lcm(base, derivado);
  const ciclos = lcmAB / base;
  const fmtBpm = (v) => Number.isInteger(v) ? v : v.toFixed(2);

  return (
    <div style={{
      background:"#1e2028", borderRadius:12, padding:"20px 24px",
      maxWidth:680, margin:"0 auto",
      display:"flex", flexDirection:"column", gap:18,
    }}>
      {/* BPM base */}
      <div>
        <div style={{ color:"#555", fontSize:9, fontFamily:"monospace", letterSpacing:2, marginBottom:8 }}>BPM BASE</div>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:52, fontWeight:700, color:"#ff6b4a", lineHeight:1, minWidth:96 }}>
            {bpmBase}
          </div>
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:6 }}>
            <input type="range" min={30} max={300} value={bpmBase}
              onChange={(e) => onBpmBase(parseInt(e.target.value))}
              style={{ width:"100%", accentColor:"#ff6b4a" }} />
            <div style={{ display:"flex", gap:5 }}>
              {[-10,-1,+1,+10].map((d) => (
                <button key={d} onClick={() => onBpmBase(Math.min(300, Math.max(30, bpmBase + d)))} style={{
                  background:"#252830", border:"1px solid #ff6b4a33", borderRadius:5,
                  color:"#ff6b4a", fontFamily:"monospace", fontSize:11, padding:"4px 9px", cursor:"pointer",
                }}>{d > 0 ? `+${d}` : d}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* selectors */}
      <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:200 }}>
          <div style={{ color:"#555", fontSize:9, fontFamily:"monospace", letterSpacing:1, marginBottom:8 }}>
            BASE <span style={{ color:"#444" }}>· anillo exterior</span>
          </div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {BASE_VALUES.map((v) => {
              const on = v === base;
              return (
                <button key={v} onClick={() => onBase(v)} style={{
                  background: on ? "#ff6b4a" : "#252830",
                  border:`1px solid ${on ? "#ff6b4a" : "#3a3d47"}`,
                  borderRadius:6, color: on ? "#15171c" : "#666",
                  fontFamily:"'JetBrains Mono',monospace", fontSize:15, fontWeight: on ? 700 : 400,
                  padding:"6px 13px", cursor:"pointer", minWidth:38, textAlign:"center",
                }}>{v}</button>
              );
            })}
          </div>
        </div>
        <div style={{ flex:1, minWidth:200 }}>
          <div style={{ color:"#555", fontSize:9, fontFamily:"monospace", letterSpacing:1, marginBottom:8 }}>
            DERIVADO <span style={{ color:"#444" }}>· anillo interior</span>
          </div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {DERIVADO_VALUES.map((v) => {
              const on = v === derivado;
              return (
                <button key={v} onClick={() => onDeriv(v)} style={{
                  background: on ? "#4ad9ff" : "#252830",
                  border:`1px solid ${on ? "#4ad9ff" : "#3a3d47"}`,
                  borderRadius:6, color: on ? "#15171c" : "#666",
                  fontFamily:"'JetBrains Mono',monospace", fontSize:15, fontWeight: on ? 700 : 400,
                  padding:"6px 13px", cursor:"pointer", minWidth:38, textAlign:"center",
                }}>{v}</button>
              );
            })}
          </div>
        </div>
      </div>

      {/* info */}
      <div style={{
        background:"#15171c", borderRadius:8, padding:"16px 20px",
        display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px 32px",
        border:"1px solid #252830",
      }}>
        <div>
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1 }}>RELACIÓN</div>
          <div style={{ color:"#eee", fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700, marginTop:3 }}>{ratio}</div>
        </div>
        <div>
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1 }}>NOMBRE</div>
          <div style={{ color:"#ccc", fontFamily:"monospace", fontSize:14, fontWeight:600, marginTop:3 }}>{poly.name}</div>
        </div>
        <div>
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1 }}>BPM DERIVADO</div>
          <div style={{ color:"#4ad9ff", fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700, marginTop:3 }}>{fmtBpm(bpmB)}</div>
        </div>
        <div>
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1 }}>CATEGORÍA</div>
          <div style={{ color:"#777", fontFamily:"monospace", fontSize:13, marginTop:3 }}>{poly.cat}</div>
        </div>
        <div style={{ gridColumn:"1 / -1", borderTop:"1px solid #1e2028", paddingTop:12 }}>
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1, marginBottom:4 }}>COINCIDENCIA</div>
          <div style={{ color:"#666", fontFamily:"monospace", fontSize:12, lineHeight:1.8 }}>
            Coinciden cada <span style={{ color:"#ddd", fontWeight:700 }}>{lcmAB}</span> subdivisiones
            <span style={{ margin:"0 10px", color:"#333" }}>·</span>
            Ciclo completo cada <span style={{ color:"#ddd", fontWeight:700 }}>{ciclos}</span> ciclos base
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── poly preset row ──────────────────────────────────────────────────────────
function PolyPresets({ onSelect, active }) {
  return (
    <div style={{ textAlign:"center" }}>
      <div style={{ color:"#444", fontSize:9, fontFamily:"monospace", letterSpacing:2, marginBottom:8 }}>PRESETS DE POLIMETRÍA</div>
      <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap" }}>
        {POLY_PRESETS.map((p) => {
          const on = active === p.label;
          return (
            <button key={p.label} onClick={() => onSelect(p)} style={{
              background: on ? "#ff6b4a18" : "#1e2028",
              border:`1px solid ${on ? "#ff6b4a" : "#3a3d47"}`,
              borderRadius:6, color: on ? "#ff6b4a" : "#666",
              fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight: on ? 700 : 400,
              padding:"6px 12px", cursor:"pointer", transition:"all 0.15s",
            }}>{p.label}</button>
          );
        })}
      </div>
    </div>
  );
}

// ─── picker ───────────────────────────────────────────────────────────────────
function Picker({ label, items, value, onChange, accent }) {
  return (
    <div>
      <div style={{ color:"#555", fontSize:9, fontFamily:"monospace", letterSpacing:1, marginBottom:5 }}>{label}</div>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
        {items.map(({ key, label: lbl }) => {
          const on = value === key;
          return (
            <button key={key} onClick={() => onChange(key)} style={{
              background: on ? accent : "#252830",
              border:`1px solid ${on ? accent : "#3a3d47"}`,
              borderRadius:4, color: on ? "#15171c" : "#666",
              fontFamily:"monospace", fontSize:9, fontWeight: on ? 700 : 400,
              padding:"3px 6px", cursor:"pointer", transition:"all 0.1s",
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
  const tapRef = useRef([]);
  const accent    = color === "A" ? "#ff6b4a" : "#4ad9ff";
  const dimAccent = color === "A" ? "#6a2a18" : "#174d5e";
  const total     = beatsPerMeasure(timeSig);

  const handleTap = () => {
    const now = performance.now();
    const taps = tapRef.current;
    taps.push(now); if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      const ints = []; for (let i = 1; i < taps.length; i++) ints.push(taps[i] - taps[i-1]);
      const avg = ints.reduce((a, b) => a + b, 0) / ints.length;
      const v = Math.round(60000 / avg);
      if (v >= 30 && v <= 300) onChange({ bpm: v });
    }
  };

  return (
    <div style={{
      background:"#1e2028",
      border:`2px solid ${running ? accent + "55" : accent + "1a"}`,
      borderRadius:12, padding:"20px",
      display:"flex", flexDirection:"column", gap:14,
      flex:1, minWidth:270, transition:"border-color 0.25s",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ background:accent, color:"#15171c", fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:12, padding:"2px 10px", borderRadius:4, letterSpacing:2 }}>MET {color}</span>
        <button onClick={onToggle} style={{
          background: running ? "#2a1010" : "#0d2616",
          border:`1px solid ${running ? "#ff4a4a" : "#4aff7a"}`,
          borderRadius:6, padding:"5px 14px", cursor:"pointer",
          display:"flex", alignItems:"center", gap:6,
          fontFamily:"monospace", fontSize:11, fontWeight:700,
          color: running ? "#ff4a4a" : "#4aff7a",
          boxShadow: running ? "none" : "0 0 10px #4aff7a33",
          transition:"all 0.15s",
        }}>
          {running ? <Square size={11} /> : <Play size={11} />}{running ? "STOP" : "PLAY"}
        </button>
      </div>

      <div style={{ display:"flex", alignItems:"flex-end", gap:12 }}>
        <div style={{ flex:1, textAlign:"center" }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:64, fontWeight:700, color:accent, lineHeight:1, letterSpacing:-2, textShadow: running ? `0 0 24px ${accent}55` : "none", transition:"text-shadow 0.3s" }}>{Math.round(bpm)}</div>
          <div style={{ color:"#444", fontSize:10, marginTop:2, fontFamily:"monospace" }}>BPM</div>
        </div>
        <div style={{ background:"#15171c", border:`1px solid ${accent}2a`, borderRadius:6, padding:"6px 10px", textAlign:"center", minWidth:58 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:700, color: running ? accent : "#333", lineHeight:1, transition:"color 0.3s" }}>{String(measures).padStart(3,"0")}</div>
          <div style={{ color:"#444", fontSize:8, marginTop:3, fontFamily:"monospace", letterSpacing:1 }}>BAR</div>
        </div>
      </div>

      <div>
        <input type="range" min={30} max={300} value={Math.round(bpm)}
          onChange={(e) => onChange({ bpm: parseInt(e.target.value) })}
          style={{ width:"100%", accentColor:accent, cursor:"pointer" }} />
        <div style={{ display:"flex", justifyContent:"space-between", color:"#444", fontSize:9, fontFamily:"monospace" }}><span>30</span><span>300</span></div>
      </div>

      <div style={{ display:"flex", gap:5, justifyContent:"center" }}>
        {[-10,-1,+1,+10].map((d) => (
          <button key={d} onClick={() => onChange({ bpm: Math.min(300, Math.max(30, Math.round(bpm)+d)) })} style={{ background:"#252830", border:`1px solid ${accent}33`, borderRadius:5, color:accent, fontFamily:"monospace", fontSize:12, padding:"5px 10px", cursor:"pointer" }}>{d > 0 ? `+${d}` : d}</button>
        ))}
      </div>

      <button onClick={handleTap} style={{ background:`${accent}14`, border:`1px solid ${accent}44`, borderRadius:7, color:accent, fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:600, padding:"8px", cursor:"pointer", letterSpacing:1 }}>TAP TEMPO</button>

      <div>
        <div style={{ color:"#444", fontSize:9, fontFamily:"monospace", marginBottom:6, letterSpacing:1 }}>COMPÁS</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
          {TIME_SIGNATURES.map((sig) => (
            <button key={sig} onClick={() => onChange({ timeSig: sig })} style={{ background: timeSig===sig ? accent : "#252830", border:`1px solid ${timeSig===sig ? accent : "#3a3d47"}`, borderRadius:5, color: timeSig===sig ? "#15171c" : "#777", fontFamily:"monospace", fontSize:11, padding:"3px 8px", cursor:"pointer", fontWeight: timeSig===sig ? 700 : 400 }}>{sig}</button>
          ))}
        </div>
      </div>

      <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap" }}>
        {Array.from({ length:total }, (_,i) => (
          <div key={i} style={{ width:15, height:15, borderRadius:"50%", background: beat===i ? (i===0 ? accent : `${accent}77`) : (i===0 ? dimAccent : "#222530"), boxShadow: beat===i ? `0 0 8px ${accent}` : "none", border:`1px solid ${accent}1a`, transition:"background 0.04s, box-shadow 0.04s" }} />
        ))}
      </div>

      <div style={{ borderTop:`1px solid ${accent}1a`, paddingTop:12, display:"flex", flexDirection:"column", gap:8 }}>
        <Picker label="FUERTE (beat 1)" items={SOUNDS}       value={strongSound}  onChange={(v) => onChange({ strongSound:v })}  accent={accent} />
        <Picker label="DÉBIL"           items={SOUNDS}       value={weakSound}    onChange={(v) => onChange({ weakSound:v })}    accent={accent} />
        <Picker label="SUBDIVISIÓN"     items={SUBDIVISIONS} value={subdivision}  onChange={(v) => onChange({ subdivision:v })}  accent={accent} />
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <button onClick={() => onChange({ muted:!muted })} style={{ background:"none", border:"none", cursor:"pointer", color: muted ? "#333" : accent, padding:2 }}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
        <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => onChange({ volume: parseFloat(e.target.value) })} style={{ flex:1, accentColor:accent }} disabled={muted} />
        <span style={{ color:"#444", fontSize:9, fontFamily:"monospace", width:26, textAlign:"right" }}>{Math.round(volume*100)}</span>
      </div>
    </div>
  );
}

// ─── dual switch ──────────────────────────────────────────────────────────────
function DualSwitch({ on, onToggle }) {
  return (
    <button onClick={onToggle} style={{
      position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", zIndex:1001,
      display:"flex", alignItems:"center", gap:12,
      background: on ? "#2a1010" : "#0d2616",
      border:`2px solid ${on ? "#ff4a4a" : "#4aff7a"}`,
      borderRadius:12, padding:"14px 36px",
      cursor:"pointer", userSelect:"none",
      boxShadow: on ? "0 0 20px #ff4a4a44" : "0 0 24px #4aff7a55",
      transition:"all 0.2s",
    }}>
      {on
        ? <Square size={22} color="#ff4a4a" />
        : <Play  size={22} color="#4aff7a" />
      }
      <span style={{
        fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:700, letterSpacing:2,
        color: on ? "#ff4a4a" : "#4aff7a",
        transition:"color 0.2s",
      }}>{on ? "DETENER" : "INICIAR"}</span>
    </button>
  );
}

// ─── progressive practice ─────────────────────────────────────────────────────
function ProgressivePractice({ onBpmChange, onActivate, running }) {
  const [on, setOn]     = useState(false);
  const [cfg, setCfg]   = useState({ bpmStart:60, bpmMax:140, increment:5, intervalSec:120, onMax:"stop" });
  const [curBpm, setCurBpm]     = useState(60);
  const [timeLeft, setTimeLeft] = useState(120);
  const curBpmRef = useRef(60);
  const cfgRef    = useRef(cfg);
  const onBpmRef  = useRef(onBpmChange);
  const timerRef  = useRef(null);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);
  useEffect(() => { onBpmRef.current = onBpmChange; }, [onBpmChange]);

  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const set  = (k, v) => setCfg((c) => ({ ...c, [k]:v }));

  const start = () => {
    curBpmRef.current = cfg.bpmStart;
    setCurBpm(cfg.bpmStart); setTimeLeft(cfg.intervalSec);
    onBpmRef.current(cfg.bpmStart); onActivate(); setOn(true);
  };
  const stop = () => { setOn(false); clearInterval(timerRef.current); };

  useEffect(() => {
    if (!on) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t > 1) return t - 1;
        const c = cfgRef.current;
        const next = Math.min(curBpmRef.current + c.increment, c.bpmMax);
        curBpmRef.current = next; setCurBpm(next); onBpmRef.current(next);
        if (next >= c.bpmMax) {
          if (c.onMax === "stop")    stop();
          if (c.onMax === "restart") { curBpmRef.current = c.bpmStart; setCurBpm(c.bpmStart); onBpmRef.current(c.bpmStart); }
        }
        return c.intervalSec;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [on]);

  return (
    <div style={{ background:"#1e2028", borderRadius:12, padding:20, border:`1px solid ${on ? "#ffd04a44" : "#252830"}`, transition:"border-color 0.3s" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ color:"#555", fontSize:10, fontFamily:"monospace", letterSpacing:2 }}>PRÁCTICA PROGRESIVA</div>
        <button onClick={on ? stop : start} style={{ background: on ? "#3d2a0d" : "#252830", border:`1px solid ${on ? "#ffd04a" : "#3a3d47"}`, borderRadius:6, color: on ? "#ffd04a" : "#666", fontFamily:"monospace", fontSize:11, fontWeight:600, padding:"5px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          {on ? <Square size={11} /> : <Play size={11} />}{on ? "DETENER" : "INICIAR"}
        </button>
      </div>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom: on ? 14 : 0 }}>
        {[["BPM INICIO","bpmStart",30,280],["BPM MÁX","bpmMax",40,300],["+ BPM","increment",1,20],["SEG / PASO","intervalSec",10,600]].map(([lbl,k,mn,mx]) => (
          <div key={k} style={{ display:"flex", flexDirection:"column", gap:3, minWidth:80 }}>
            <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1 }}>{lbl}</div>
            <input type="number" min={mn} max={mx} value={cfg[k]} onChange={(e) => set(k, Math.max(mn, parseInt(e.target.value)||mn))} disabled={on}
              style={{ background:"#252830", border:"1px solid #3a3d47", borderRadius:5, color: on ? "#555" : "#ddd", fontFamily:"monospace", fontSize:13, padding:"4px 8px", width:"100%", outline:"none" }} />
          </div>
        ))}
        <div style={{ display:"flex", flexDirection:"column", gap:3, minWidth:90 }}>
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1 }}>AL LLEGAR AL MÁX</div>
          <select value={cfg.onMax} onChange={(e) => set("onMax",e.target.value)} disabled={on}
            style={{ background:"#252830", border:"1px solid #3a3d47", borderRadius:5, color: on ? "#555" : "#ddd", fontFamily:"monospace", fontSize:11, padding:"4px 6px", outline:"none", cursor:"pointer" }}>
            <option value="stop">Detener</option>
            <option value="hold">Mantener</option>
            <option value="restart">Reiniciar</option>
          </select>
        </div>
      </div>
      {on && (
        <div style={{ display:"flex", gap:16, alignItems:"center", background:"#15171c", borderRadius:8, padding:"12px 16px", border:"1px solid #ffd04a22" }}>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:28, color:"#ffd04a", fontWeight:700, lineHeight:1 }}>{curBpm}</div>
            <div style={{ color:"#555", fontSize:8, fontFamily:"monospace", marginTop:2 }}>BPM ACTUAL</div>
          </div>
          <ChevronRight size={14} color="#333" />
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, color:"#666", lineHeight:1 }}>{Math.min(curBpm + cfg.increment, cfg.bpmMax)}</div>
            <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", marginTop:2 }}>PRÓXIMO</div>
          </div>
          <div style={{ flex:1 }} />
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:26, fontWeight:700, color: timeLeft <= 10 ? "#ff6b4a" : "#ffd04a", lineHeight:1, transition:"color 0.3s" }}>{fmt(timeLeft)}</div>
            <div style={{ color:"#555", fontSize:8, fontFamily:"monospace", marginTop:2 }}>PRÓXIMO INCREMENTO</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── beat lights (split-screen, A on top half / B on bottom half) ────────────
function BeatLights({ metA, metB, runningA, runningB, measuresA, measuresB, enabled }) {
  if (!enabled) return null;
  const totalA = beatsPerMeasure(metA.timeSig);
  const totalB = beatsPerMeasure(metB.timeSig);
  const onA = runningA && metA.beat >= 0;
  const onB = runningB && metB.beat >= 0;
  const dispA = metA.lastBeat >= 0 ? metA.lastBeat + 1 : "–";
  const dispB = metB.lastBeat >= 0 ? metB.lastBeat + 1 : "–";

  const halfStyle = (on, color, top) => ({
    position:"fixed", left:0, right:0, [top ? "top" : "bottom"]:0, height:"50vh",
    pointerEvents:"none", zIndex:998,
    background: on ? color : "transparent",
    transition: on ? "background-color 0.01s" : "background-color 0.18s ease-out",
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6,
  });
  const numStyle = (on, color, visible) => ({
    fontFamily:"'JetBrains Mono',monospace", fontWeight:800, lineHeight:1,
    fontSize:"min(20vw, 200px)",
    color: on ? "#15171c" : color,
    opacity: visible ? (on ? 0.92 : 0.22) : 0,
    transition:"color 0.05s, opacity 0.15s",
  });
  const subStyle = (on, color, visible) => ({
    fontFamily:"monospace", fontSize:18, letterSpacing:3, fontWeight:600,
    color: on ? "#15171c" : color,
    opacity: visible ? (on ? 0.8 : 0.28) : 0,
    transition:"color 0.05s, opacity 0.15s",
  });

  return (
    <>
      <div style={halfStyle(onA, "#ff6b4a", true)}>
        <span style={numStyle(onA, "#ff6b4a", runningA)}>{dispA}<span style={{ fontSize:"0.35em" }}>/{totalA}</span></span>
        <span style={subStyle(onA, "#ff6b4a", runningA)}>MET A · BAR {String(measuresA).padStart(3,"0")}</span>
      </div>
      <div style={halfStyle(onB, "#4ad9ff", false)}>
        <span style={numStyle(onB, "#4ad9ff", runningB)}>{dispB}<span style={{ fontSize:"0.35em" }}>/{totalB}</span></span>
        <span style={subStyle(onB, "#4ad9ff", runningB)}>MET B · BAR {String(measuresB).padStart(3,"0")}</span>
      </div>
    </>
  );
}

// ─── flash toggle button ──────────────────────────────────────────────────────
function FlashToggle({ on, onToggle }) {
  return (
    <button onClick={onToggle} title={on ? "Desactivar destello de pantalla" : "Activar destello de pantalla"} style={{
      position:"fixed", top:16, right:16, zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center",
      width:40, height:40, borderRadius:10,
      background: on ? "#ffd04a1a" : "#1e2028",
      border:`1px solid ${on ? "#ffd04a" : "#3a3d47"}`,
      color: on ? "#ffd04a" : "#555",
      cursor:"pointer", transition:"all 0.15s",
      boxShadow: on ? "0 0 12px #ffd04a44" : "none",
    }}>
      <Lightbulb size={18} fill={on ? "#ffd04a" : "none"} />
    </button>
  );
}

// ─── tap tempo button (top-left, DUAL SINC mode) ──────────────────────────────
function TapTempoButton({ onTap }) {
  return (
    <button onClick={onTap} title="Tap tempo" style={{
      position:"fixed", top:16, left:16, zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center",
      width:40, height:40, borderRadius:10,
      background:"#ff6b4a1a", border:"1px solid #ff6b4a55",
      color:"#ff6b4a", cursor:"pointer", transition:"all 0.1s",
      fontFamily:"monospace", fontSize:9, fontWeight:700, letterSpacing:0.5,
    }}>TAP</button>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function loadPresets() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]"); } catch { return []; } }
function savePresets(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }

const DEFAULT_A = { bpm:120, timeSig:"4/4", volume:0.7, muted:false, beat:-1, lastBeat:-1, strongSound:"click", weakSound:"beep",  subdivision:1 };
const DEFAULT_B = { bpm:90,  timeSig:"3/4", volume:0.7, muted:false, beat:-1, lastBeat:-1, strongSound:"click", weakSound:"wood",  subdivision:1 };

// ─── main ─────────────────────────────────────────────────────────────────────
export default function DualMetronome() {
  // mode — polimetría is the primary / default mode
  const [mode, setMode] = useState("metrica");
  const modeRef = useRef("metrica");

  // polimetría params + refs (refs updated synchronously so restartNow can read them)
  const [relBase,    setRelBase]    = useState(4);
  const [relDeriv,   setRelDeriv]   = useState(5);
  const [relBpmBase, setRelBpmBase] = useState(90);
  const relBaseRef  = useRef(4);
  const relDerivRef = useRef(5);

  // shared audio state
  const [runningA, setRunningA] = useState(false);
  const [runningB, setRunningB] = useState(false);
  const [dualOn,   setDualOn]   = useState(false);
  // metA/metB start already aligned with the default polimetría params
  // (relBase=4, relDeriv=5, relBpmBase=90) so the visualizer's ring counts
  // and MCM match the "5:4" label from the very first render.
  const [metA, setMetA] = useState(() => ({ ...DEFAULT_A, bpm:90,    timeSig:"4/4" }));
  const [metB, setMetB] = useState(() => ({ ...DEFAULT_B, bpm:112.5, timeSig:"5/4" }));
  const [measuresA, setMeasuresA] = useState(0);
  const [measuresB, setMeasuresB] = useState(0);
  const [presets,    setPresets]   = useState(loadPresets);
  const [presetName, setPresetName] = useState("");
  const [activePolyPreset, setActivePolyPreset] = useState(null);
  const [flashOn, setFlashOn] = useState(true);

  // audio refs — the scheduler reads exclusively from these, never from state
  const ctxRef   = useRef(null);
  const schedRef = useRef(null);
  const runARef  = useRef(false);
  const runBRef  = useRef(false);
  const nextARef = useRef(0);
  const nextBRef = useRef(0);
  const tickARef = useRef(0);
  const tickBRef = useRef(0);
  const metARef  = useRef(metA);
  const metBRef  = useRef(metB);
  // keep metRefs in sync with state (for non-restart param changes like volume/mute)
  useEffect(() => { metARef.current = metA; }, [metA]);
  useEffect(() => { metBRef.current = metB; }, [metB]);
  useEffect(() => () => { clearInterval(schedRef.current); ctxRef.current?.close(); }, []);

  // ── scheduler ──────────────────────────────────────────────────────────────
  const scheduleBeats = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") return;
    const ahead = ctx.currentTime + 0.1;

    const sched = (runRef, metRef, nextRef, tickRef, setMeasures, setMet) => {
      if (!runRef.current) return;
      const { bpm, timeSig, volume, muted, strongSound, weakSound, subdivision } = metRef.current;
      const total  = beatsPerMeasure(timeSig);
      const subInt = (60 / bpm) / subdivision;
      while (nextRef.current < ahead) {
        const tick    = tickRef.current;
        const subIdx  = tick % subdivision;
        const beatIdx = Math.floor(tick / subdivision) % total;
        const isMain  = subIdx === 0;
        const isAcc   = isMain && beatIdx === 0;
        const t       = nextRef.current;
        if (!muted) {
          if (isAcc)       synthClick(ctx, t, strongSound, volume);
          else if (isMain) synthClick(ctx, t, weakSound,   volume * 0.55);
          else             synthClick(ctx, t, weakSound,   volume * 0.15);
        }
        if (isAcc) {
          const bar   = Math.floor(tick / (subdivision * total)) + 1;
          const delay = Math.max(0, (t - ctx.currentTime) * 1000);
          setTimeout(() => setMeasures(bar), delay);
        }
        if (isMain) {
          const cb    = beatIdx;
          const delay = Math.max(0, (t - ctx.currentTime) * 1000);
          setTimeout(() => {
            setMet((p) => ({ ...p, beat: cb, lastBeat: cb }));
            setTimeout(() => setMet((p) => ({ ...p, beat: -1 })), 75);
          }, delay);
        }
        nextRef.current += subInt;
        tickRef.current++;
      }
    };
    sched(runARef, metARef, nextARef, tickARef, setMeasuresA, setMetA);
    sched(runBRef, metBRef, nextBRef, tickBRef, setMeasuresB, setMetB);
  }, []);

  // ── restartNow ─────────────────────────────────────────────────────────────
  // Call AFTER writing new values into metARef / metBRef.
  // Immediately stops the current scheduler and restarts it from beat 0,
  // guaranteeing that both metronomes are in sync with no phase drift.
  const restartNow = useCallback(() => {
    const wasA = runARef.current, wasB = runBRef.current;
    clearInterval(schedRef.current); schedRef.current = null;
    ctxRef.current?.close(); ctxRef.current = null;
    runARef.current = false; runBRef.current = false;
    if (!wasA && !wasB) return; // nothing was playing, nothing to restart
    const ctx = new AudioContext(); ctxRef.current = ctx;
    const t0  = ctx.currentTime + 0.05;
    if (wasA) { nextARef.current = t0; tickARef.current = 0; runARef.current = true; }
    if (wasB) { nextBRef.current = t0; tickBRef.current = 0; runBRef.current = true; }
    setRunningA(wasA); setRunningB(wasB); setDualOn(wasA && wasB);
    setMeasuresA(0); setMeasuresB(0);
    scheduleBeats(); schedRef.current = setInterval(scheduleBeats, 25);
  }, [scheduleBeats]);

  // ── engine ─────────────────────────────────────────────────────────────────
  const ensureCtx = () => {
    if (!ctxRef.current || ctxRef.current.state === "closed") ctxRef.current = new AudioContext();
    return ctxRef.current;
  };
  const hardStop = useCallback(() => {
    runARef.current = false; runBRef.current = false;
    clearInterval(schedRef.current); schedRef.current = null;
    ctxRef.current?.close(); ctxRef.current = null;
    setRunningA(false); setRunningB(false); setDualOn(false);
    setMetA((p) => ({ ...p, beat:-1 })); setMetB((p) => ({ ...p, beat:-1 }));
    setMeasuresA(0); setMeasuresB(0);
  }, []);
  const startDual = useCallback(() => {
    const ctx = new AudioContext(); ctxRef.current = ctx;
    const t0  = ctx.currentTime + 0.1;
    nextARef.current = t0; nextBRef.current = t0;
    tickARef.current = 0;  tickBRef.current = 0;
    setMeasuresA(0); setMeasuresB(0);
    runARef.current = true; runBRef.current = true;
    setRunningA(true); setRunningB(true); setDualOn(true);
    scheduleBeats(); schedRef.current = setInterval(scheduleBeats, 25);
  }, [scheduleBeats]);

  // ── individual toggles ─────────────────────────────────────────────────────
  const toggleA = () => {
    if (runARef.current) {
      runARef.current = false; setRunningA(false); setDualOn(false); setMetA((p) => ({ ...p, beat:-1 }));
      if (!runBRef.current) { clearInterval(schedRef.current); schedRef.current = null; ctxRef.current?.close(); ctxRef.current = null; }
    } else {
      const ctx = ensureCtx();
      nextARef.current = ctx.currentTime + 0.1; tickARef.current = 0; setMeasuresA(0);
      runARef.current = true; setRunningA(true); setDualOn(false);
      if (!schedRef.current) { scheduleBeats(); schedRef.current = setInterval(scheduleBeats, 25); }
    }
  };
  const toggleB = () => {
    if (runBRef.current) {
      runBRef.current = false; setRunningB(false); setDualOn(false); setMetB((p) => ({ ...p, beat:-1 }));
      if (!runARef.current) { clearInterval(schedRef.current); schedRef.current = null; ctxRef.current?.close(); ctxRef.current = null; }
    } else {
      const ctx = ensureCtx();
      nextBRef.current = ctx.currentTime + 0.1; tickBRef.current = 0; setMeasuresB(0);
      runBRef.current = true; setRunningB(true); setDualOn(false);
      if (!schedRef.current) { scheduleBeats(); schedRef.current = setInterval(scheduleBeats, 25); }
    }
  };
  const toggleDual = () => { if (dualOn) { hardStop(); } else { hardStop(); startDual(); } };

  // ── polimetría param handlers ──────────────────────────────────────────────
  // Update both refs and state, then restart so there is zero phase drift.
  const applyPoliParams = useCallback((bpmBase, base, deriv) => {
    const bpmB = bpmBase * deriv / base;
    metARef.current = { ...metARef.current, bpm: bpmBase, timeSig: `${base}/4` };
    metBRef.current = { ...metBRef.current, bpm: bpmB,    timeSig: `${deriv}/4` };
    setMetA((p) => ({ ...p, bpm: bpmBase, timeSig: `${base}/4` }));
    setMetB((p) => ({ ...p, bpm: bpmB,    timeSig: `${deriv}/4` }));
    restartNow();
  }, [restartNow]);

  const handleRelBpmBase = useCallback((v) => {
    setRelBpmBase(v);
    applyPoliParams(v, relBaseRef.current, relDerivRef.current);
  }, [applyPoliParams]);

  // global tap tempo (top-left button, DUAL SINC mode) — feeds BPM Base
  const tapRefGlobal = useRef([]);
  const handleGlobalTap = useCallback(() => {
    const now = performance.now();
    const taps = tapRefGlobal.current;
    taps.push(now); if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      const ints = []; for (let i = 1; i < taps.length; i++) ints.push(taps[i] - taps[i-1]);
      const avg = ints.reduce((a, b) => a + b, 0) / ints.length;
      const v = Math.round(60000 / avg);
      if (v >= 30 && v <= 300) handleRelBpmBase(v);
    }
  }, [handleRelBpmBase]);

  const handleRelBase = useCallback((v) => {
    setRelBase(v); relBaseRef.current = v;
    applyPoliParams(relBpmBase, v, relDerivRef.current);
  // relBpmBase captured at call time; applyPoliParams is stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyPoliParams, relBpmBase]);

  const handleRelDeriv = useCallback((v) => {
    setRelDeriv(v); relDerivRef.current = v;
    applyPoliParams(relBpmBase, relBaseRef.current, v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyPoliParams, relBpmBase]);

  // ── dual libre param handlers ──────────────────────────────────────────────
  // Restart only for params that affect timing (bpm, timeSig, subdivision).
  // Sound/volume/mute changes are picked up by the scheduler on the next tick.
  const changeMetA = useCallback((patch) => {
    metARef.current = { ...metARef.current, ...patch };
    setMetA((p) => ({ ...p, ...patch }));
    setActivePolyPreset(null);
    if (runARef.current && Object.keys(patch).some((k) => NEEDS_RESTART.has(k))) restartNow();
  }, [restartNow]);

  const changeMetB = useCallback((patch) => {
    metBRef.current = { ...metBRef.current, ...patch };
    setMetB((p) => ({ ...p, ...patch }));
    setActivePolyPreset(null);
    if (runBRef.current && Object.keys(patch).some((k) => NEEDS_RESTART.has(k))) restartNow();
  }, [restartNow]);

  // ── mode switch ────────────────────────────────────────────────────────────
  const handleModeChange = useCallback((newMode) => {
    hardStop();
    setMode(newMode); modeRef.current = newMode;
    if (newMode === "metrica") {
      const bpmB = relBpmBase * relDerivRef.current / relBaseRef.current;
      metARef.current = { ...metARef.current, bpm: relBpmBase, timeSig: `${relBaseRef.current}/4` };
      metBRef.current = { ...metBRef.current, bpm: bpmB,       timeSig: `${relDerivRef.current}/4` };
      setMetA((p) => ({ ...p, bpm: relBpmBase, timeSig: `${relBaseRef.current}/4` }));
      setMetB((p) => ({ ...p, bpm: bpmB,       timeSig: `${relDerivRef.current}/4` }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardStop, relBpmBase]);

  // ── progressive practice bpm handler ──────────────────────────────────────
  const handlePracticeBpm = useCallback((bpm) => {
    if (modeRef.current === "metrica") {
      setRelBpmBase(bpm);
      applyPoliParams(bpm, relBaseRef.current, relDerivRef.current);
    } else {
      metARef.current = { ...metARef.current, bpm };
      metBRef.current = { ...metBRef.current, bpm };
      setMetA((p) => ({ ...p, bpm }));
      setMetB((p) => ({ ...p, bpm }));
      restartNow();
    }
  }, [applyPoliParams, restartNow]);

  const handlePracticeActivate = useCallback(() => {
    if (!runARef.current || !runBRef.current) startDual();
  }, [startDual]);

  // ── presets ────────────────────────────────────────────────────────────────
  const applyPolyPreset = (p) => { changeMetA({ timeSig:p.a }); changeMetB({ timeSig:p.b }); setActivePolyPreset(p.label); };
  const savePreset = () => {
    const name  = presetName.trim() || `Preset ${presets.length + 1}`;
    const entry = { id:Date.now(), name,
      a:{ bpm:metA.bpm, timeSig:metA.timeSig, strongSound:metA.strongSound, weakSound:metA.weakSound, subdivision:metA.subdivision },
      b:{ bpm:metB.bpm, timeSig:metB.timeSig, strongSound:metB.strongSound, weakSound:metB.weakSound, subdivision:metB.subdivision },
    };
    const u = [...presets, entry]; setPresets(u); savePresets(u); setPresetName("");
  };
  const loadPreset = (p) => {
    changeMetA({ ...p.a, strongSound:p.a.strongSound??"click", weakSound:p.a.weakSound??"beep", subdivision:p.a.subdivision??1 });
    changeMetB({ ...p.b, strongSound:p.b.strongSound??"click", weakSound:p.b.weakSound??"wood", subdivision:p.b.subdivision??1 });
  };
  const deletePreset = (id) => { const u = presets.filter((p) => p.id !== id); setPresets(u); savePresets(u); };

  // ── render ─────────────────────────────────────────────────────────────────
  const isMetrica = mode === "metrica";
  const centerLabel = isMetrica ? `${relDeriv}:${relBase}` : undefined;
  // full-screen color/performance view only while something is actually playing
  const performanceMode = flashOn && (runningA || runningB);

  return (
    <div style={{ minHeight:"100vh", background:"#15171c", color:"#ddd", fontFamily:"system-ui,sans-serif", padding: performanceMode ? 0 : "24px 16px", boxSizing:"border-box" }}>
      <BeatLights metA={metA} metB={metB} runningA={runningA} runningB={runningB} measuresA={measuresA} measuresB={measuresB} enabled={performanceMode} />
      <FlashToggle on={flashOn} onToggle={() => setFlashOn((v) => !v)} />
      {isMetrica && <TapTempoButton onTap={handleGlobalTap} />}
      <DualSwitch on={dualOn} onToggle={toggleDual} />

      {!performanceMode && (
      <>
      {/* header */}
      <div style={{ textAlign:"center", marginBottom:18 }}>
        <h1 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700, color:"#eee", margin:0, letterSpacing:4 }}>
          DUAL <span style={{ color:"#ff6b4a" }}>METRO</span><span style={{ color:"#4ad9ff" }}>NOME</span>
        </h1>
      </div>

      {/* mode selector */}
      <div style={{ marginBottom:20 }}>
        <ModeSelector mode={mode} setMode={handleModeChange} />
      </div>

      {/* ── POLIMETRÍA (default/primary) ── */}
      {isMetrica && (
        <>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:18 }}>
            <CircularVisualizer metA={metA} metB={metB} runningA={runningA} runningB={runningB} centerLabel={centerLabel} showSubtitle={false} />
          </div>
          <div style={{ marginBottom:20 }}>
            <PoliPanel
              bpmBase={relBpmBase} base={relBase} derivado={relDeriv}
              onBpmBase={handleRelBpmBase} onBase={handleRelBase} onDeriv={handleRelDeriv}
            />
          </div>
          <div style={{ maxWidth:680, margin:"0 auto 90px" }}>
            <ProgressivePractice onBpmChange={handlePracticeBpm} onActivate={handlePracticeActivate} running={runningA && runningB} />
          </div>
        </>
      )}

      {/* ── DUAL LIBRE (secondary) ── */}
      {!isMetrica && (
        <>
          <div style={{ maxWidth:880, margin:"0 auto 18px" }}>
            <PolyPresets onSelect={applyPolyPreset} active={activePolyPreset} />
          </div>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:18 }}>
            <CircularVisualizer metA={metA} metB={metB} runningA={runningA} runningB={runningB} />
          </div>
          <div style={{ display:"flex", gap:20, flexWrap:"wrap", justifyContent:"center", maxWidth:880, margin:"0 auto" }}>
            <MetronomePanel color="A" state={metA} onChange={changeMetA} running={runningA} onToggle={toggleA} measures={measuresA} />
            <MetronomePanel color="B" state={metB} onChange={changeMetB} running={runningB} onToggle={toggleB} measures={measuresB} />
          </div>
          <div style={{ maxWidth:880, margin:"22px auto 18px" }}>
            <ProgressivePractice onBpmChange={handlePracticeBpm} onActivate={handlePracticeActivate} running={runningA && runningB} />
          </div>
          {/* presets */}
          <div style={{ maxWidth:880, margin:"0 auto 90px", background:"#1e2028", borderRadius:12, padding:20 }}>
            <div style={{ color:"#444", fontSize:9, fontFamily:"monospace", marginBottom:14, letterSpacing:2 }}>PRESETS</div>
            <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
              <input value={presetName} onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && savePreset()}
                placeholder="Nombre del preset..."
                style={{ flex:1, minWidth:150, background:"#252830", border:"1px solid #3a3d47", borderRadius:6, color:"#ddd", fontFamily:"monospace", fontSize:12, padding:"7px 11px", outline:"none" }} />
              <button onClick={savePreset} style={{ background:"#ff6b4a1a", border:"1px solid #ff6b4a55", borderRadius:6, color:"#ff6b4a", cursor:"pointer", padding:"7px 13px", display:"flex", alignItems:"center", gap:5, fontFamily:"monospace", fontSize:12 }}>
                <Save size={13} /> Guardar
              </button>
            </div>
            {presets.length === 0 ? (
              <div style={{ color:"#333", fontSize:11, fontFamily:"monospace", textAlign:"center", padding:14 }}>No hay presets guardados aún.</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {presets.map((pr) => (
                  <div key={pr.id} style={{ display:"flex", alignItems:"center", gap:8, background:"#252830", borderRadius:7, padding:"9px 12px" }}>
                    <button onClick={() => loadPreset(pr)} style={{ flex:1, background:"none", border:"none", color:"#ddd", fontFamily:"monospace", fontSize:12, textAlign:"left", cursor:"pointer", padding:0 }}>
                      <span style={{ color:"#666" }}>{pr.name}</span>
                      <span style={{ color:"#ff6b4a", marginLeft:10 }}>A: {Math.round(pr.a.bpm)} {pr.a.timeSig}</span>
                      <span style={{ color:"#4ad9ff", marginLeft:10 }}>B: {Math.round(pr.b.bpm)} {pr.b.timeSig}</span>
                    </button>
                    <button onClick={() => deletePreset(pr.id)} style={{ background:"none", border:"none", color:"#444", cursor:"pointer", padding:3, display:"flex", alignItems:"center" }}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}
