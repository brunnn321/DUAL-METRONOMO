import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Square, Volume2, VolumeX, ChevronRight, Lightbulb } from "lucide-react";

// ─── math ─────────────────────────────────────────────────────────────────────
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a * b) / gcd(a, b);

// ─── constants ────────────────────────────────────────────────────────────────
const beatsPerMeasure = (sig) => parseInt(sig.split("/")[0]);
const fmtMMSS = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

const SOUNDS = [
  { key:"click", label:"CLICK" }, { key:"beep",  label:"BEEP"  },
  { key:"wood",  label:"WOOD"  }, { key:"clave", label:"CLAVE" },
  { key:"rim",   label:"RIM"   }, { key:"hat",   label:"HAT"   },
];

// figures: how each beat (pulso) gets subdivided — Dual Libre only
const FIGURES = [
  { value:1 }, { value:2 }, { value:3 }, { value:4 }, { value:5 },
  { value:6 }, { value:7 }, { value:8 }, { value:9 }, { value:11 }, { value:13 }, { value:15 },
];

const BASE_VALUES     = [2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15];
const DERIVADO_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15];

// params that require a scheduler restart to stay in sync
const NEEDS_RESTART = new Set(["bpm", "timeSig", "subdivision"]);

// ─── audio ────────────────────────────────────────────────────────────────────
// pan: -1 = full left, 0 = center, +1 = full right
function synthClick(ctx, time, soundKey, volume, pan = 0) {
  if (volume < 0.001) return;
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, time);
  panner.connect(ctx.destination);

  if (soundKey === "hat") {
    const len = Math.floor(ctx.sampleRate * 0.045);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6000;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(panner);
    g.gain.setValueAtTime(volume * 0.7, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.start(time); return;
  }
  const C = { click:["square",900,.065], beep:["sine",660,.14], wood:["sine",280,.055], clave:["sine",1500,.042], rim:["triangle",420,.038] };
  const [type, freq, decay] = C[soundKey] ?? C.click;
  const osc = ctx.createOscillator(); const g = ctx.createGain();
  osc.connect(g); g.connect(panner);
  osc.type = type; osc.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(volume * 0.85, time + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, time + decay);
  osc.start(time); osc.stop(time + decay + 0.01);
}

// ─── mode selector ────────────────────────────────────────────────────────────
function ModeSelector({ mode, setMode }) {
  return (
    <div style={{ display:"flex", background:"#1a1c22", borderRadius:8, padding:3, maxWidth:520, margin:"0 auto", gap:2 }}>
      {[["metrica","DUAL SINC","#a78bfa"],["libre","DUAL LIBRE","#ffd04a"],["polimetria","DUAL POLY","#4aff9a"]].map(([k, lbl, color]) => {
        const on = mode === k;
        return (
          <button key={k} onClick={() => setMode(k)} style={{
            flex:1, background: on ? `${color}1a` : "none",
            border:`1px solid ${on ? color : "transparent"}`,
            borderRadius:6, color: on ? color : "#444",
            fontFamily:"'JetBrains Mono',monospace", fontSize:10,
            fontWeight: on ? 600 : 400, padding:"8px 10px",
            cursor:"pointer", letterSpacing:0.5, transition:"all 0.15s",
            boxShadow: on ? `0 0 10px ${color}33` : "none",
          }}>{lbl}</button>
        );
      })}
    </div>
  );
}

// ─── circular visualizer ──────────────────────────────────────────────────────
// regular polygon vertices, same angle convention as ring() (i=0 at top)
function polyPoints(total, r, cx, cy) {
  return Array.from({ length: total }, (_, i) => {
    const a = (i / total) * 2 * Math.PI - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}
// point along a REGULAR polygon's perimeter at fraction t (0-1) — equal-length
// edges mean "equal time per edge" exactly matches "equal length per edge"
function pointAtT(points, t) {
  const n = points.length;
  const segT = ((t % 1) + 1) % 1 * n;
  const i = Math.floor(segT) % n;
  const frac = segT - Math.floor(segT);
  const [x0, y0] = points[i];
  const [x1, y1] = points[(i + 1) % n];
  return [x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac];
}

function CircularVisualizer({ metA, metB, runningA, runningB, centerLabel, showSubtitle, showMcm = true }) {
  const [coincide, setCoincide] = useState(false);
  const tRef = useRef(null);
  const totalA = beatsPerMeasure(metA.timeSig);
  const totalB = beatsPerMeasure(metB.timeSig);
  const lcmAB  = lcm(totalA, totalB);
  const CA = "#ff6b4a", CB = "#4ad9ff";
  const S = 320, cx = 160, cy = 160, rA = 128, rB = 84;
  const pulse = (metA.beat === 0 || metB.beat === 0) && (runningA || runningB);
  const [vizStyle, setVizStyle] = useState("rings"); // "rings" | "necklace"

  useEffect(() => {
    if (metA.beat === 0 && metB.beat === 0 && (runningA || runningB)) {
      setCoincide(true);
      clearTimeout(tRef.current);
      tRef.current = setTimeout(() => setCoincide(false), 550);
    }
  }, [metA.beat, metB.beat, runningA, runningB]);

  // cycle counters increment on every downbeat (beat 0) — changing the key
  // remounts the arc/wave elements so their CSS animation restarts in sync
  // with the real tempo instead of looping on a fixed timer
  const cycleARef = useRef(0), cycleBRef = useRef(0);
  const [cycleA, setCycleA] = useState(0), [cycleB, setCycleB] = useState(0);
  const lastDownARef = useRef(0), lastDownBRef = useRef(0);
  useEffect(() => {
    if (metA.beat === 0 && runningA) { lastDownARef.current = performance.now(); setCycleA(++cycleARef.current); }
  }, [metA.beat, runningA]);
  useEffect(() => {
    if (metB.beat === 0 && runningB) { lastDownBRef.current = performance.now(); setCycleB(++cycleBRef.current); }
  }, [metB.beat, runningB]);
  const durA = totalA * 60 / metA.bpm;
  const durB = totalB * 60 / metB.bpm;

  // necklace mode: single rAF loop drives both the trailing stroke and the
  // traveling dot from the *same* progress fraction, so they can never drift
  // apart from each other (unlike separately-timed CSS/SMIL animations)
  const [progA, setProgA] = useState(0), [progB, setProgB] = useState(0);
  useEffect(() => {
    if (vizStyle !== "necklace") return;
    let raf;
    const tick = () => {
      if (runningA && durA > 0) setProgA(((performance.now() - lastDownARef.current) / 1000 / durA) % 1);
      if (runningB && durB > 0) setProgB(((performance.now() - lastDownBRef.current) / 1000 / durB) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [vizStyle, runningA, runningB, durA, durB]);

  const pointsA = polyPoints(totalA, rA, cx, cy);
  const pointsB = polyPoints(totalB, rB, cx, cy);
  const necklace = (points, color, running, prog) => {
    if (!running) return null;
    const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ") + " Z";
    const [dx, dy] = pointAtT(points, prog);
    const [tx, ty] = points[0]; // downbeat vertex — always marked, never animated away
    return (
      <>
        <polygon points={points.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" opacity={0.18} />
        <polygon points={points.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round"
          pathLength={1} strokeDasharray={1} strokeDashoffset={1 - prog}
          style={{ filter:`drop-shadow(0 0 6px ${color})` }} />
        <polygon points={`${tx},${ty - 7} ${tx + 6},${ty + 5} ${tx - 6},${ty + 5}`} fill={color} style={{ filter:`drop-shadow(0 0 7px ${color})` }} />
        <circle cx={dx} cy={dy} r={5.5} fill="#fff" style={{ filter:"drop-shadow(0 0 8px #fff)" }} />
      </>
    );
  };

  const ring = (total, r, activeBeat, color) => {
    const dr = total <= 8 ? 12 : total <= 12 ? 9 : 7;
    return Array.from({ length:total }, (_, i) => {
      const a = (i / total) * 2 * Math.PI - Math.PI / 2;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      const on = activeBeat === i;
      return (
        <g key={i}>
          {on && <circle cx={x} cy={y} r={dr+16} fill={`${color}44`} />}
          {on && <circle cx={x} cy={y} r={dr+9}  fill={`${color}22`} />}
          <circle cx={x} cy={y} r={i === 0 ? dr+3 : dr}
            fill={on ? color : i === 0 ? `${color}dd` : `${color}88`}
            stroke={on ? "#fff" : "none"} strokeWidth={on ? 2 : 0}
            style={{ filter: on ? `drop-shadow(0 0 18px ${color}) drop-shadow(0 0 6px #fff)` : "none", transition:"fill 0.05s" }} />
        </g>
      );
    });
  };

  const label = centerLabel ?? `${totalA}:${totalB}`;

  return (
    <div style={{
      display:"flex", flexDirection:"column", alignItems:"center", gap:10,
      transform: pulse ? "scale(1.035)" : "scale(1)",
      transition: pulse ? "transform 0.04s" : "transform 0.25s ease-out",
    }}>
      <div style={{ position:"relative" }}>
        <button onClick={() => setVizStyle((v) => (v === "rings" ? "necklace" : "rings"))} title="Cambiar estilo de visualizador" style={{
          position:"absolute", top:-16, left:"50%", transform:"translateX(-50%)", zIndex:2,
          width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center",
          background:"#ffd04a1a", border:"1px solid #ffd04a", borderRadius:"50%",
          color:"#ffd04a", cursor:"pointer",
          boxShadow:"0 0 12px #ffd04a44",
        }}>
          {vizStyle === "rings"
            ? <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            : <svg width="16" height="16" viewBox="0 0 16 16"><polygon points="8,1 15,6 12,15 4,15 1,6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>}
        </button>
        <div style={{
          position:"absolute", inset:-30, borderRadius:"50%",
          background: `radial-gradient(circle, ${coincide ? "#ffffff22" : `${CA}14`} 0%, transparent 70%)`,
          transition:"background 0.3s", pointerEvents:"none",
        }} />
        <svg width={S} height={S} style={{ overflow:"visible", position:"relative" }}>
          <defs>
            <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={coincide ? "#ffffff33" : "#ffffff0a"} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={rA+4} fill="url(#centerGlow)" />
          <circle cx={cx} cy={cy} r={rA} fill="none" stroke={`${CA}77`} strokeWidth={3} />
          <circle cx={cx} cy={cy} r={rB} fill="none" stroke={`${CB}77`} strokeWidth={3} />
          {coincide && <circle cx={cx} cy={cy} r={54} fill="#ffffff14" stroke="#ffffff88" strokeWidth={2.5} style={{ filter:"drop-shadow(0 0 16px #fff)" }} />}
          {vizStyle === "rings" && runningA && (
            <circle key={`arcA-${cycleA}`} cx={cx} cy={cy} r={rA} fill="none" stroke={CA} strokeWidth={4}
              strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ animation:`fillArc ${durA}s linear forwards`, filter:`drop-shadow(0 0 5px ${CA})` }} />
          )}
          {vizStyle === "rings" && runningB && (
            <circle key={`arcB-${cycleB}`} cx={cx} cy={cy} r={rB} fill="none" stroke={CB} strokeWidth={4}
              strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ animation:`fillArc ${durB}s linear forwards`, filter:`drop-shadow(0 0 5px ${CB})` }} />
          )}
          {vizStyle === "necklace" && necklace(pointsA, CA, runningA, progA)}
          {vizStyle === "necklace" && necklace(pointsB, CB, runningB, progB)}
          {ring(totalA, rA, metA.beat, CA)}
          {ring(totalB, rB, metB.beat, CB)}
          {vizStyle === "rings" && runningA && cycleA > 0 && (
            <circle key={`waveA-${cycleA}`} cx={cx} cy={cy - rA} r={5} fill="none" stroke={CA} strokeWidth={2.5}
              style={{ animation:"waveBurst 0.55s ease-out forwards" }} />
          )}
          {vizStyle === "rings" && runningB && cycleB > 0 && (
            <circle key={`waveB-${cycleB}`} cx={cx} cy={cy - rB} r={5} fill="none" stroke={CB} strokeWidth={2.5}
              style={{ animation:"waveBurst 0.55s ease-out forwards" }} />
          )}
          <text x={cx} y={showMcm ? cy - 10 : cy + 10} textAnchor="middle"
            fill={coincide ? "#fff" : "#ddd"} fontSize={30}
            fontFamily="'JetBrains Mono',monospace" fontWeight="800"
            style={{ transition:"fill 0.2s", filter: coincide ? "drop-shadow(0 0 10px #fff)" : "none" }}>{label}</text>
          {showMcm && (
            <text x={cx} y={cy+13} textAnchor="middle" fill="#999" fontSize={11} fontFamily="monospace" fontWeight="600">
              MCM = {lcmAB}
            </text>
          )}
        </svg>
      </div>
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
  const fmtBpm = (v) => Number.isInteger(v) ? v : v.toFixed(2);

  return (
    <div style={{
      background:"#1e2028", borderRadius:12, padding:"20px 24px",
      maxWidth:680, margin:"0 auto",
      display:"flex", flexDirection:"column", gap:18,
    }}>
      {/* BPM base */}
      <div>
        <div style={{ color:"#555", fontSize:9, fontFamily:"monospace", letterSpacing:2, marginBottom:8 }}>BPM A</div>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:52, fontWeight:700, color:"#ff6b4a", lineHeight:1, minWidth:96 }}>
            {bpmBase}
          </div>
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:6 }}>
            <input type="range" min={1} max={600} value={bpmBase}
              onChange={(e) => onBpmBase(parseInt(e.target.value))}
              style={{ width:"100%", accentColor:"#ff6b4a" }} />
            <div style={{ display:"flex", gap:5 }}>
              {[-10,-1,+1,+10].map((d) => (
                <button key={d} onClick={() => onBpmBase(Math.min(600, Math.max(1, bpmBase + d)))} style={{
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
            A
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
            B
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
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1 }}>BPM B</div>
          <div style={{ color:"#4ad9ff", fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700, marginTop:3 }}>{fmtBpm(bpmB)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── sound select (dropdown) ──────────────────────────────────────────────────
function SoundSelect({ label, value, onChange, accent }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:7, flex:1, minWidth:120 }}>
      <span style={{ color:"#555", fontSize:9, fontFamily:"monospace", letterSpacing:1, minWidth:40 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        flex:1, background:"#252830", border:`1px solid ${accent}33`, borderRadius:5,
        color:accent, fontFamily:"monospace", fontSize:11, fontWeight:600,
        padding:"5px 8px", outline:"none", cursor:"pointer",
      }}>
        {SOUNDS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </div>
  );
}

// ─── metronome panel ──────────────────────────────────────────────────────────
function MetronomePanel({ color, state, onChange, onTiempoChange, running, onToggle, measures }) {
  const { bpm, volume, muted, subTick, strongSound, weakSound, subdivision } = state;
  const baseBpm = state.baseBpm ?? bpm;
  const [soundOpen, setSoundOpen] = useState(false);
  const tapRef = useRef([]);
  const accent    = color === "A" ? "#ff6b4a" : "#4ad9ff";
  const dimAccent = color === "A" ? "#6a2a18" : "#174d5e";

  const handleTap = () => {
    const now = performance.now();
    const taps = tapRef.current;
    taps.push(now); if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      const ints = []; for (let i = 1; i < taps.length; i++) ints.push(taps[i] - taps[i-1]);
      const avg = ints.reduce((a, b) => a + b, 0) / ints.length;
      const v = Math.round(60000 / avg);
      if (v >= 1 && v <= 600) onChange({ bpm: v, baseBpm: v });
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
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>
        <button onClick={onToggle} title={running ? "Detener" : "Reproducir"} style={{
          background: running ? "#2a1010" : "#0d2616",
          border:`1px solid ${running ? "#ff4a4a" : "#4aff7a"}`,
          borderRadius:8, width:38, height:32, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          color: running ? "#ff4a4a" : "#4aff7a",
          boxShadow: running ? "none" : "0 0 10px #4aff7a33",
          transition:"all 0.15s",
        }}>
          {running ? <Square size={13} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
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
        <input type="range" min={1} max={600} value={Math.round(bpm)}
          onChange={(e) => { const v = parseInt(e.target.value); onChange({ bpm: v, baseBpm: v }); }}
          style={{ width:"100%", accentColor:accent, cursor:"pointer" }} />
        <div style={{ display:"flex", justifyContent:"space-between", color:"#444", fontSize:9, fontFamily:"monospace" }}><span>1</span><span>600</span></div>
      </div>

      <div style={{ display:"flex", gap:5, justifyContent:"center" }}>
        {[-10,-1,+1,+10].map((d) => (
          <button key={d} onClick={() => { const v = Math.min(600, Math.max(1, Math.round(bpm)+d)); onChange({ bpm: v, baseBpm: v }); }} style={{ background:"#252830", border:`1px solid ${accent}33`, borderRadius:5, color:accent, fontFamily:"monospace", fontSize:12, padding:"5px 10px", cursor:"pointer" }}>{d > 0 ? `+${d}` : d}</button>
        ))}
      </div>

      <button onClick={handleTap} style={{ background:`${accent}14`, border:`1px solid ${accent}44`, borderRadius:7, color:accent, fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:600, padding:"8px", cursor:"pointer", letterSpacing:1 }}>TAP TEMPO</button>

      <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
        {FIGURES.map(({ value }) => {
          const on = subdivision === value;
          return (
            <button key={value} onClick={() => onChange({ subdivision: value })} style={{
              background: on ? accent : "#252830", border:`1px solid ${on ? accent : "#3a3d47"}`,
              borderRadius:6, color: on ? "#15171c" : "#666",
              fontFamily:"'JetBrains Mono',monospace", fontSize:15, fontWeight: on ? 700 : 400,
              padding:"6px 13px", cursor:"pointer", minWidth:38, textAlign:"center",
            }}>{value}</button>
          );
        })}
      </div>

      <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap" }}>
        {Array.from({ length:subdivision }, (_,i) => (
          <div key={i} style={{ width:15, height:15, borderRadius:"50%", background: subTick===i ? (i===0 ? accent : `${accent}77`) : (i===0 ? dimAccent : "#222530"), boxShadow: subTick===i ? `0 0 8px ${accent}` : "none", border:`1px solid ${accent}1a`, transition:"background 0.04s, box-shadow 0.04s" }} />
        ))}
      </div>

      <div style={{ borderTop:`1px solid ${accent}1a` }}>
        <button onClick={() => setSoundOpen((o) => !o)} style={{
          width:"100%", background:"none", border:"none", cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0 2px",
        }}>
          <span style={{ color:"#555", fontSize:9, fontFamily:"monospace", letterSpacing:1 }}>SONIDO Y VOLUMEN</span>
          <ChevronRight size={12} color="#555" style={{ transform: soundOpen ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
        </button>
        <div style={{ display: soundOpen ? "flex" : "none", flexDirection:"column", gap:8, paddingTop:8 }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <SoundSelect label="FUERTE" value={strongSound} onChange={(v) => onChange({ strongSound:v })} accent={accent} />
            <SoundSelect label="DÉBIL"  value={weakSound}   onChange={(v) => onChange({ weakSound:v })}   accent={accent} />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={() => onChange({ muted:!muted })} style={{ background:"none", border:"none", cursor:"pointer", color: muted ? "#333" : accent, padding:2 }}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => onChange({ volume: parseFloat(e.target.value) })} style={{ flex:1, accentColor:accent }} disabled={muted} />
            <span style={{ color:"#444", fontSize:9, fontFamily:"monospace", width:26, textAlign:"right" }}>{Math.round(volume*100)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── dual switch ──────────────────────────────────────────────────────────────
function DualSwitch({ on, onToggle }) {
  return (
    <button onClick={onToggle} title={on ? "Detener" : "Iniciar"} style={{
      position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", zIndex:1001,
      display:"flex", alignItems:"center", justifyContent:"center",
      width:64, height:64, borderRadius:"50%",
      background: on ? "#2a1010" : "#0d2616",
      border:`2px solid ${on ? "#ff4a4a" : "#4aff7a"}`,
      cursor:"pointer", userSelect:"none",
      boxShadow: on ? "0 0 20px #ff4a4a44" : "0 0 24px #4aff7a55",
      transition:"all 0.2s",
    }}>
      {on
        ? <Square size={26} color="#ff4a4a" fill="#ff4a4a" />
        : <Play  size={28} color="#4aff7a" fill="#4aff7a" style={{ marginLeft:3 }} />
      }
    </button>
  );
}

// ─── progressive practice ─────────────────────────────────────────────────────
function ProgressivePractice({ onBpmChange, onActivate, running, onStatus }) {
  const [on, setOn]     = useState(false);
  const [cfg, setCfg]   = useState({ bpmStart:60, bpmMax:140, increment:5, intervalSec:120, onMax:"stop" });
  const [curBpm, setCurBpm]     = useState(60);
  const [timeLeft, setTimeLeft] = useState(120);
  const curBpmRef = useRef(60);
  const cfgRef    = useRef(cfg);
  const onBpmRef  = useRef(onBpmChange);
  const timerRef  = useRef(null);
  const onStatusRef = useRef(onStatus);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);
  useEffect(() => { onBpmRef.current = onBpmChange; }, [onBpmChange]);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  useEffect(() => { onStatusRef.current?.({ progOn: on, progLeft: timeLeft }); }, [on, timeLeft]);
  useEffect(() => () => onStatusRef.current?.({ progOn: false, progLeft: 0 }), []);

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
        {[["BPM INICIO","bpmStart",1,580],["BPM MÁX","bpmMax",2,600],["+ BPM","increment",1,20],["SEG / PASO","intervalSec",10,600]].map(([lbl,k,mn,mx]) => (
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

// ─── practice timer (pomodoro-style countdown, stops metronome at 0) ─────────
const TIMER_MINUTES = [5, 10, 15, 20, 30, 45, 60];

function playAlarm() {
  const ctx = new AudioContext();
  [880, 1100, 1320].forEach((freq, i) => {
    const t = ctx.currentTime + i * 0.3;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = "sine"; osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.start(t); osc.stop(t + 0.3);
  });
  setTimeout(() => ctx.close(), 1400);
}

function PracticeTimer({ onFinish, onStatus }) {
  const [minutes, setMinutes] = useState(15);
  const [on, setOn]           = useState(false);
  const [done, setDone]       = useState(false);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const timerRef  = useRef(null);
  const onFinishRef = useRef(onFinish);
  const onStatusRef = useRef(onStatus);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  // report status upward (collapsed bar + performance-mode corner countdown)
  useEffect(() => { onStatusRef.current?.({ timerOn: on, timerLeft: timeLeft }); }, [on, timeLeft]);
  useEffect(() => () => onStatusRef.current?.({ timerOn: false, timerLeft: 0 }), []);

  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  const start = () => { setTimeLeft(minutes * 60); setDone(false); setOn(true); };
  const stop  = () => { setOn(false); clearInterval(timerRef.current); };

  useEffect(() => {
    if (!on) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t > 1) return t - 1;
        setOn(false); setDone(true);
        playAlarm(); onFinishRef.current();
        return 0;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [on]);

  const pick = (m) => { setMinutes(m); if (!on) { setTimeLeft(m * 60); setDone(false); } };

  return (
    <div style={{ background:"#1e2028", borderRadius:12, padding:20, border:`1px solid ${on ? "#ffd04a44" : "#252830"}`, transition:"border-color 0.3s" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
        <div style={{ color:"#555", fontSize:10, fontFamily:"monospace", letterSpacing:2 }}>TIMER</div>
        <button onClick={on ? stop : start} style={{ background: on ? "#3d2a0d" : "#252830", border:`1px solid ${on ? "#ffd04a" : "#3a3d47"}`, borderRadius:6, color: on ? "#ffd04a" : "#666", fontFamily:"monospace", fontSize:11, fontWeight:600, padding:"5px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          {on ? <Square size={11} /> : <Play size={11} />}{on ? "DETENER" : "INICIAR"}
        </button>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:38, fontWeight:700, lineHeight:1, minWidth:120,
          color: done ? "#4aff7a" : on && timeLeft <= 10 ? "#ff6b4a" : "#ffd04a", transition:"color 0.3s" }}>
          {done ? "¡LISTO!" : fmt(timeLeft)}
        </div>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", flex:1 }}>
          {TIMER_MINUTES.map((m) => (
            <button key={m} onClick={() => pick(m)} disabled={on} style={{
              background: minutes === m ? "#ffd04a" : "#252830",
              border:`1px solid ${minutes === m ? "#ffd04a" : "#3a3d47"}`,
              borderRadius:5, color: minutes === m ? "#15171c" : on ? "#444" : "#777",
              fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight: minutes === m ? 700 : 400,
              padding:"5px 10px", cursor: on ? "default" : "pointer", minWidth:34,
            }}>{m}</button>
          ))}
          <input type="number" min={1} max={180} value={minutes} disabled={on}
            onChange={(e) => pick(Math.min(180, Math.max(1, parseInt(e.target.value) || 1)))}
            style={{ background:"#252830", border:"1px solid #3a3d47", borderRadius:5, color: on ? "#555" : "#ddd", fontFamily:"monospace", fontSize:12, padding:"4px 8px", width:52, outline:"none" }} />
        </div>
      </div>
    </div>
  );
}

// ─── practice panel (collapsible, tabs: TIMER | PROGRESIVA) ───────────────────
// Both children stay mounted (hidden with display:none) so a running timer or
// progressive session keeps counting while collapsed or on the other tab.
function PracticePanel({ onBpmChange, onActivate, running, onFinish, status, onStatus }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState("timer");
  const active = status?.timerOn || status?.progOn;
  return (
    <div style={{ background:"#1e2028", borderRadius:12, border:`1px solid ${active ? "#ffd04a44" : "#252830"}`, transition:"border-color 0.3s" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width:"100%", background:"none", border:"none", cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px", gap:10,
      }}>
        <span style={{ color:"#555", fontSize:10, fontFamily:"monospace", letterSpacing:2 }}>PRÁCTICA</span>
        <span style={{ display:"flex", alignItems:"center", gap:12 }}>
          {status?.timerOn && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700, color:"#ffd04a" }}>
              {fmtMMSS(status.timerLeft)}
            </span>
          )}
          {status?.progOn && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700, color:"#ffd04a" }}>
              ▲ {fmtMMSS(status.progLeft)}
            </span>
          )}
          <ChevronRight size={14} color="#555" style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
        </span>
      </button>
      <div style={{ display: open ? "flex" : "none", flexDirection:"column", gap:12, padding:"0 16px 16px" }}>
        <div style={{ display:"flex", background:"#15171c", borderRadius:8, padding:3, gap:2 }}>
          {[["timer","TIMER"],["prog","PROGRESIVA"]].map(([k, lbl]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={{
                flex:1, background: on ? "#ffd04a1a" : "none",
                border:`1px solid ${on ? "#ffd04a" : "transparent"}`,
                borderRadius:6, color: on ? "#ffd04a" : "#444",
                fontFamily:"monospace", fontSize:10, fontWeight: on ? 600 : 400,
                padding:"7px 10px", cursor:"pointer", letterSpacing:0.5,
              }}>{lbl}</button>
            );
          })}
        </div>
        <div style={{ display: tab === "timer" ? "block" : "none" }}>
          <PracticeTimer onFinish={onFinish} onStatus={onStatus} />
        </div>
        <div style={{ display: tab === "prog" ? "block" : "none" }}>
          <ProgressivePractice onBpmChange={onBpmChange} onActivate={onActivate} running={running} onStatus={onStatus} />
        </div>
      </div>
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
    transition:"none",
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6,
  });
  const numStyle = (on, color, visible) => ({
    fontFamily:"'JetBrains Mono',monospace", fontWeight:800, lineHeight:1,
    fontSize:"min(20vw, 200px)",
    color: on ? "#15171c" : color,
    opacity: visible ? (on ? 0.92 : 0.22) : 0,
    transition:"none",
  });
  const subStyle = (on, color, visible) => ({
    fontFamily:"monospace", fontSize:18, letterSpacing:3, fontWeight:600,
    color: on ? "#15171c" : color,
    opacity: visible ? (on ? 0.8 : 0.28) : 0,
    transition:"none",
  });

  return (
    <>
      <div style={halfStyle(onA, "#ff6b4a", true)}>
        <span style={numStyle(onA, "#ff6b4a", runningA)}>{dispA}<span style={{ fontSize:"0.35em" }}>/{totalA}</span></span>
        <span style={subStyle(onA, "#ff6b4a", runningA)}>BAR {String(measuresA).padStart(3,"0")}</span>
      </div>
      <div style={halfStyle(onB, "#4ad9ff", false)}>
        <span style={numStyle(onB, "#4ad9ff", runningB)}>{dispB}<span style={{ fontSize:"0.35em" }}>/{totalB}</span></span>
        <span style={subStyle(onB, "#4ad9ff", runningB)}>BAR {String(measuresB).padStart(3,"0")}</span>
      </div>
    </>
  );
}

// ─── flash toggle button ──────────────────────────────────────────────────────
function FlashToggle({ on, onToggle, viz, onVizToggle, showVizOption }) {
  return (
    <div style={{ position:"fixed", top:16, right:16, zIndex:1000, display:"flex", alignItems:"center", gap:8 }}>
      {on && showVizOption && (
        <button onClick={onVizToggle} title="Cambiar vista de pantalla completa" style={{
          width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center",
          background:"#ffd04a1a", border:"1px solid #ffd04a", borderRadius:10,
          color:"#ffd04a", cursor:"pointer",
        }}>
          {viz === "lights"
            ? <svg width="18" height="18" viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6" fill="currentColor" /><rect x="9" y="1" width="6" height="6" fill="currentColor" opacity="0.4" /><rect x="1" y="9" width="6" height="6" fill="currentColor" opacity="0.4" /><rect x="9" y="9" width="6" height="6" fill="currentColor" /></svg>
            : <svg width="18" height="18" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
        </button>
      )}
      <button onClick={onToggle} title={on ? "Desactivar destello de pantalla" : "Activar destello de pantalla"} style={{
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
    </div>
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

// ─── sync volume + sound editor (DUAL SINC) ───────────────────────────────────
function SyncControls({ metA, metB, onChangeA, onChangeB }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ maxWidth:680, margin:"0 auto 18px", background:"#1e2028", borderRadius:12, border:"1px solid #252830" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width:"100%", background:"none", border:"none", cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px",
      }}>
        <span style={{ color:"#555", fontSize:10, fontFamily:"monospace", letterSpacing:2 }}>SONIDO Y VOLUMEN</span>
        <ChevronRight size={14} color="#555" style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
      </button>
      <div style={{ display: open ? "flex" : "none", flexDirection:"column", gap:16, padding:"0 20px 16px" }}>

      {/* volume row */}
      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
        {[
          { label:"A", accent:"#ff6b4a", met:metA, onChange:onChangeA },
          { label:"B", accent:"#4ad9ff", met:metB, onChange:onChangeB },
        ].map(({ label, accent, met, onChange }) => (
          <div key={label} style={{ flex:1, minWidth:200 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <button onClick={() => onChange({ muted: !met.muted })} style={{ background:"none", border:"none", cursor:"pointer", color: met.muted ? "#333" : accent, padding:2 }}>
                {met.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              <input type="range" min={0} max={1} step={0.01} value={met.volume}
                onChange={(e) => onChange({ volume: parseFloat(e.target.value) })}
                style={{ flex:1, accentColor:accent }} disabled={met.muted} />
              <span style={{ color:"#444", fontSize:9, fontFamily:"monospace", width:26, textAlign:"right" }}>{Math.round(met.volume * 100)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* sound pickers row */}
      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
        {[
          { label:"A", accent:"#ff6b4a", met:metA, onChange:onChangeA },
          { label:"B", accent:"#4ad9ff", met:metB, onChange:onChangeB },
        ].map(({ label, accent, met, onChange }) => (
          <div key={label} style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column", gap:8 }}>
            <SoundSelect label="FUERTE" value={met.strongSound}
              onChange={(v) => onChange({ strongSound: v })} accent={accent} />
            <SoundSelect label="DÉBIL" value={met.weakSound}
              onChange={(v) => onChange({ weakSound: v })} accent={accent} />
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

// ─── polimetría panel ─────────────────────────────────────────────────────────
function PolyMetriaPanel({ bpm, beatsA, beatsB, onBpm, onBeatsA, onBeatsB }) {
  const lcmAB = lcm(beatsA, beatsB);
  return (
    <div style={{ background:"#1e2028", borderRadius:12, padding:"20px 24px", maxWidth:680, margin:"0 auto", display:"flex", flexDirection:"column", gap:18 }}>
      {/* BPM compartido */}
      <div>
        <div style={{ color:"#555", fontSize:9, fontFamily:"monospace", letterSpacing:2, marginBottom:8 }}>BPM</div>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:52, fontWeight:700, color:"#4aff9a", lineHeight:1, minWidth:96 }}>{bpm}</div>
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:6 }}>
            <input type="range" min={1} max={600} value={bpm} onChange={(e) => onBpm(parseInt(e.target.value))} style={{ width:"100%", accentColor:"#4aff9a" }} />
            <div style={{ display:"flex", gap:5 }}>
              {[-10,-1,+1,+10].map((d) => (
                <button key={d} onClick={() => onBpm(Math.min(600, Math.max(1, bpm + d)))} style={{ background:"#252830", border:"1px solid #4aff9a33", borderRadius:5, color:"#4aff9a", fontFamily:"monospace", fontSize:11, padding:"4px 9px", cursor:"pointer" }}>{d > 0 ? `+${d}` : d}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* selectores de tiempos */}
      <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
        {[
          { label:"A", color:"#ff6b4a", val:beatsA, set:onBeatsA },
          { label:"B", color:"#4ad9ff", val:beatsB, set:onBeatsB },
        ].map(({ label, color, val, set }) => (
          <div key={label} style={{ flex:1, minWidth:200 }}>
            <div style={{ color:"#555", fontSize:9, fontFamily:"monospace", letterSpacing:1, marginBottom:8 }}>
              <span style={{ color }}>●</span> {label}
            </div>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {[2,3,4,5,6,7,8,9,11,13,15].map((n) => (
                <button key={n} onClick={() => set(n)} style={{
                  background: val===n ? color : "#252830",
                  border:`1px solid ${val===n ? color : "#3a3d47"}`,
                  borderRadius:6, color: val===n ? "#15171c" : "#666",
                  fontFamily:"'JetBrains Mono',monospace", fontSize:15, fontWeight: val===n ? 700 : 400,
                  padding:"6px 13px", cursor:"pointer", minWidth:38, textAlign:"center",
                }}>{n}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* info MCM */}
      <div style={{ background:"#15171c", borderRadius:8, padding:"14px 18px", border:"1px solid #252830", display:"flex", gap:32, flexWrap:"wrap" }}>
        <div>
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1 }}>RELACIÓN</div>
          <div style={{ color:"#eee", fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700, marginTop:3 }}>{beatsA}:{beatsB}</div>
        </div>
        <div>
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1 }}>MCM</div>
          <div style={{ color:"#4aff9a", fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700, marginTop:3 }}>{lcmAB}</div>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ color:"#444", fontSize:8, fontFamily:"monospace", letterSpacing:1, marginBottom:4 }}>COINCIDENCIA</div>
          <div style={{ color:"#666", fontFamily:"monospace", fontSize:12, lineHeight:1.8 }}>
            El <span style={{ color:"#eee" }}>tiempo&nbsp;1</span> coincide cada{" "}
            <span style={{ color:"#4aff9a", fontWeight:700 }}>{lcmAB}</span> pulsos
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const DEFAULT_A = { bpm:120, baseBpm:120, timeSig:"4/4", volume:0.7, muted:false, beat:-1, lastBeat:-1, subTick:-1, strongSound:"click", weakSound:"beep",  subdivision:1 };
const DEFAULT_B = { bpm:90,  baseBpm:90,  timeSig:"3/4", volume:0.7, muted:false, beat:-1, lastBeat:-1, subTick:-1, strongSound:"click", weakSound:"wood",  subdivision:1 };

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
  const relMultRef = useRef(1);

  // polimetría (tercer modo) params
  const [polyBpm,    setPolyBpm]    = useState(90);
  const [polyBeatsA, setPolyBeatsA] = useState(4);
  const [polyBeatsB, setPolyBeatsB] = useState(3);
  const polyBpmRef    = useRef(90);
  const polyBeatsARef = useRef(4);
  const polyBeatsBRef = useRef(3);
  const polyMultRef = useRef(1);

  // shared audio state
  const [runningA, setRunningA] = useState(false);
  const [runningB, setRunningB] = useState(false);
  const [dualOn,   setDualOn]   = useState(false);
  // metA/metB start already aligned with the default polimetría params
  // (relBase=4, relDeriv=5, relBpmBase=90) so the visualizer's ring counts
  // and MCM match the "5:4" label from the very first render.
  const [metA, setMetA] = useState(() => ({ ...DEFAULT_A, bpm:90,    baseBpm:90,    timeSig:"4/4" }));
  const [metB, setMetB] = useState(() => ({ ...DEFAULT_B, bpm:112.5, baseBpm:112.5, timeSig:"5/4" }));
  const [measuresA, setMeasuresA] = useState(0);
  const [measuresB, setMeasuresB] = useState(0);
  const [flashOn, setFlashOn] = useState(false);
  const [fullscreenViz, setFullscreenViz] = useState("lights"); // "lights" | "circle"
  // practice status reported by PracticeTimer / ProgressivePractice
  // (shown in the collapsed PRÁCTICA bar and as a corner countdown in lights mode)
  const [practiceStatus, setPracticeStatus] = useState({});
  const updatePracticeStatus = useCallback((patch) => setPracticeStatus((p) => ({ ...p, ...patch })), []);

  // audio refs — the scheduler reads exclusively from these, never from state
  const ctxRef     = useRef(null);
  const schedRef   = useRef(null);
  const sessionRef = useRef(0); // incremented on every hardStop — invalidates pending setTimeouts
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

    const sched = (runRef, otherRef, metRef, nextRef, tickRef, setMeasures, setMet, fixedPan) => {
      if (!runRef.current) return;
      const sid = sessionRef.current; // snapshot — callbacks discard themselves if session changed
      const { bpm, timeSig, volume, muted, strongSound, weakSound, subdivision } = metRef.current;
      // center if the other metronome is muted or not running
      const otherSilent = !otherRef.current || otherRef.current.muted;
      const pan = otherSilent ? 0 : fixedPan;
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
          if (isAcc)       synthClick(ctx, t, strongSound, volume, pan);
          else if (isMain) synthClick(ctx, t, weakSound,   volume, pan);
          else             synthClick(ctx, t, weakSound,   volume, pan);
        }
        if (isAcc) {
          const bar   = Math.floor(tick / (subdivision * total)) + 1;
          const delay = Math.max(0, (t - ctx.currentTime) * 1000);
          setTimeout(() => { if (sessionRef.current !== sid) return; setMeasures(bar); }, delay);
        }
        if (isMain) {
          const cb    = beatIdx;
          const delay = Math.max(0, (t - ctx.currentTime) * 1000);
          setTimeout(() => {
            if (sessionRef.current !== sid) return;
            setMet((p) => ({ ...p, beat: cb, lastBeat: cb }));
            setTimeout(() => { if (sessionRef.current !== sid) return; setMet((p) => ({ ...p, beat: -1 })); }, 75);
          }, delay);
        }
        // subTick fires on every subdivision tick (used by the FIGURAS dot
        // ring in Dual Libre to visualize corchea/tresillo/etc. patterns)
        {
          const sb    = subIdx;
          const delay = Math.max(0, (t - ctx.currentTime) * 1000);
          setTimeout(() => {
            if (sessionRef.current !== sid) return;
            setMet((p) => ({ ...p, subTick: sb }));
            setTimeout(() => { if (sessionRef.current !== sid) return; setMet((p) => ({ ...p, subTick: -1 })); }, 60);
          }, delay);
        }
        nextRef.current += subInt;
        tickRef.current++;
      }
    };
    sched(runARef, metBRef, metARef, nextARef, tickARef, setMeasuresA, setMetA, -1);
    sched(runBRef, metARef, metBRef, nextBRef, tickBRef, setMeasuresB, setMetB, +1);
  }, []);

  // ── restartNow ─────────────────────────────────────────────────────────────
  // Call AFTER writing new values into metARef / metBRef.
  // Immediately stops the current scheduler and restarts it from beat 0,
  // guaranteeing that both metronomes are in sync with no phase drift.
  const restartNow = useCallback(() => {
    sessionRef.current++;
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
    sessionRef.current++;
    runARef.current = false; runBRef.current = false;
    clearInterval(schedRef.current); schedRef.current = null;
    ctxRef.current?.close(); ctxRef.current = null;
    setRunningA(false); setRunningB(false); setDualOn(false);
    setMetA((p) => ({ ...p, beat:-1 })); setMetB((p) => ({ ...p, beat:-1 }));
    setMeasuresA(0); setMeasuresB(0);
  }, []);
  const startDual = useCallback(() => {
    // defensive: never stack a second scheduler/context on top of a live one
    clearInterval(schedRef.current); schedRef.current = null;
    ctxRef.current?.close();
    const ctx = new AudioContext(); ctxRef.current = ctx;
    const t0  = ctx.currentTime + 0.1;
    nextARef.current = t0; nextBRef.current = t0;
    tickARef.current = 0;  tickBRef.current = 0;
    setMeasuresA(0); setMeasuresB(0);
    runARef.current = true; runBRef.current = true;
    setRunningA(true); setRunningB(true); setDualOn(true);
    scheduleBeats(); schedRef.current = setInterval(scheduleBeats, 25);
  }, [scheduleBeats]);

  // ── individual toggles (DUAL LIBRE only) ──────────────────────────────────
  const toggleA = () => {
    if (modeRef.current !== "libre") return;
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
    if (modeRef.current !== "libre") return;
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

  // ── keyboard shortcuts: Space / Enter = INICIAR/DETENER ────────────────────
  const toggleDualRef = useRef(toggleDual);
  useEffect(() => { toggleDualRef.current = toggleDual; });
  useEffect(() => {
    const h = (e) => {
      if (e.code !== "Space" && e.code !== "Enter" && e.code !== "NumpadEnter") return;
      const t = e.target.tagName;
      if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      e.preventDefault();
      toggleDualRef.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ── polimetría param handlers ──────────────────────────────────────────────
  // Update both refs and state, then restart so there is zero phase drift.
  const applyPoliParams = useCallback((bpmBase, base, deriv) => {
    const eff  = bpmBase * relMultRef.current; // ×0.5 / ×1 / ×2
    const bpmB = eff * deriv / base;
    // subdivision:1 — las FIGURAS de Dual Libre no aplican en este modo
    metARef.current = { ...metARef.current, bpm: eff,  timeSig: `${base}/4`,  subdivision:1 };
    metBRef.current = { ...metBRef.current, bpm: bpmB, timeSig: `${deriv}/4`, subdivision:1 };
    setMetA((p) => ({ ...p, bpm: eff,  timeSig: `${base}/4`,  subdivision:1 }));
    setMetB((p) => ({ ...p, bpm: bpmB, timeSig: `${deriv}/4`, subdivision:1 }));
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
      if (v >= 1 && v <= 600) handleRelBpmBase(v);
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

  // ── polimetría handlers ────────────────────────────────────────────────────
  const applyPolyParams = useCallback((bpm, beatsA, beatsB) => {
    polyBpmRef.current = bpm; polyBeatsARef.current = beatsA; polyBeatsBRef.current = beatsB;
    const eff = bpm * polyMultRef.current; // ×0.5 / ×1 / ×2
    metARef.current = { ...metARef.current, bpm: eff, timeSig: `${beatsA}/4`, subdivision:1 };
    metBRef.current = { ...metBRef.current, bpm: eff, timeSig: `${beatsB}/4`, subdivision:1 };
    setMetA((p) => ({ ...p, bpm: eff, timeSig: `${beatsA}/4`, subdivision:1 }));
    setMetB((p) => ({ ...p, bpm: eff, timeSig: `${beatsB}/4`, subdivision:1 }));
    restartNow();
  }, [restartNow]);

  const handlePolyBpm = useCallback((v) => {
    setPolyBpm(v);
    applyPolyParams(v, polyBeatsARef.current, polyBeatsBRef.current);
  }, [applyPolyParams]);

  const handlePolyBeatsA = useCallback((v) => {
    setPolyBeatsA(v); polyBeatsARef.current = v;
    applyPolyParams(polyBpmRef.current, v, polyBeatsBRef.current);
  }, [applyPolyParams]);

  const handlePolyBeatsB = useCallback((v) => {
    setPolyBeatsB(v); polyBeatsBRef.current = v;
    applyPolyParams(polyBpmRef.current, polyBeatsARef.current, v);
  }, [applyPolyParams]);

  // ── dual libre param handlers ──────────────────────────────────────────────
  // Restart only for params that affect timing (bpm, timeSig, subdivision).
  // Sound/volume/mute changes are picked up by the scheduler on the next tick.
  const changeMetA = useCallback((patch) => {
    metARef.current = { ...metARef.current, ...patch };
    setMetA((p) => ({ ...p, ...patch }));
    if (runARef.current && Object.keys(patch).some((k) => NEEDS_RESTART.has(k))) restartNow();
  }, [restartNow]);

  const changeMetB = useCallback((patch) => {
    metBRef.current = { ...metBRef.current, ...patch };
    setMetB((p) => ({ ...p, ...patch }));
    if (runBRef.current && Object.keys(patch).some((k) => NEEDS_RESTART.has(k))) restartNow();
  }, [restartNow]);

  // ── tiempo change (no restart — keeps playback position) ──────────────────
  const tiempoChangeA = useCallback((patch) => {
    metARef.current = { ...metARef.current, ...patch };
    setMetA((p) => ({ ...p, ...patch }));
  }, []);
  const tiempoChangeB = useCallback((patch) => {
    metBRef.current = { ...metBRef.current, ...patch };
    setMetB((p) => ({ ...p, ...patch }));
  }, []);

  // ── mode switch ────────────────────────────────────────────────────────────
  const handleModeChange = useCallback((newMode) => {
    hardStop();
    setMode(newMode); modeRef.current = newMode;
    if (newMode === "metrica") {
      const bpmB = relBpmBase * relDerivRef.current / relBaseRef.current;
      metARef.current = { ...metARef.current, bpm: relBpmBase, timeSig: `${relBaseRef.current}/4`,  subdivision:1 };
      metBRef.current = { ...metBRef.current, bpm: bpmB,       timeSig: `${relDerivRef.current}/4`, subdivision:1 };
      setMetA((p) => ({ ...p, bpm: relBpmBase, timeSig: `${relBaseRef.current}/4`,  subdivision:1 }));
      setMetB((p) => ({ ...p, bpm: bpmB,       timeSig: `${relDerivRef.current}/4`, subdivision:1 }));
    } else if (newMode === "polimetria") {
      const bpm = polyBpmRef.current;
      metARef.current = { ...metARef.current, bpm, timeSig: `${polyBeatsARef.current}/4`, subdivision:1 };
      metBRef.current = { ...metBRef.current, bpm, timeSig: `${polyBeatsBRef.current}/4`, subdivision:1 };
      setMetA((p) => ({ ...p, bpm, timeSig: `${polyBeatsARef.current}/4`, subdivision:1 }));
      setMetB((p) => ({ ...p, bpm, timeSig: `${polyBeatsBRef.current}/4`, subdivision:1 }));
    } else {
      // Dual Libre has no "compás" concept anymore — fix timeSig to a single
      // beat per measure so the shared circular visualizer stays consistent.
      metARef.current = { ...metARef.current, timeSig: "1/4" };
      metBRef.current = { ...metBRef.current, timeSig: "1/4" };
      setMetA((p) => ({ ...p, timeSig: "1/4" }));
      setMetB((p) => ({ ...p, timeSig: "1/4" }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardStop, relBpmBase]);

  // ── progressive practice bpm handler ──────────────────────────────────────
  const handlePracticeBpm = useCallback((bpm) => {
    if (modeRef.current === "metrica") {
      setRelBpmBase(bpm);
      applyPoliParams(bpm, relBaseRef.current, relDerivRef.current);
    } else if (modeRef.current === "polimetria") {
      setPolyBpm(bpm); polyBpmRef.current = bpm;
      applyPolyParams(bpm, polyBeatsARef.current, polyBeatsBRef.current);
    } else {
      metARef.current = { ...metARef.current, bpm };
      metBRef.current = { ...metBRef.current, bpm };
      setMetA((p) => ({ ...p, bpm }));
      setMetB((p) => ({ ...p, bpm }));
      restartNow();
    }
  }, [applyPoliParams, applyPolyParams, restartNow]);

  // ── polimetría tap tempo ───────────────────────────────────────────────────
  const tapRefPoly = useRef([]);
  const handlePolyTap = useCallback(() => {
    const now = performance.now();
    const taps = tapRefPoly.current;
    taps.push(now); if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      const ints = []; for (let i = 1; i < taps.length; i++) ints.push(taps[i] - taps[i-1]);
      const avg = ints.reduce((a, b) => a + b, 0) / ints.length;
      const v = Math.round(60000 / avg);
      if (v >= 1 && v <= 600) handlePolyBpm(v);
    }
  }, [handlePolyBpm]);

  const handlePracticeActivate = useCallback(() => {
    if (!runARef.current || !runBRef.current) startDual();
  }, [startDual]);

  // ── render ─────────────────────────────────────────────────────────────────
  const isMetrica    = mode === "metrica";
  const isPolimetria = mode === "polimetria";
  const centerLabel  = isMetrica ? `${relDeriv}:${relBase}` : isPolimetria ? `${polyBeatsA}:${polyBeatsB}` : undefined;
  // full-screen color/performance view only while something is actually playing
  const performanceMode = flashOn && (runningA || runningB);
  // circle fullscreen only makes sense where CircularVisualizer already renders (not Dual Libre)
  const canShowCircleFullscreen = isMetrica || isPolimetria;
  const showCircleFullscreen = performanceMode && fullscreenViz === "circle" && canShowCircleFullscreen;
  const showLightsFullscreen = performanceMode && !showCircleFullscreen;

  return (
    <div style={{ minHeight:"100vh", background:"#15171c", color:"#ddd", fontFamily:"system-ui,sans-serif", padding: performanceMode ? 0 : "24px 16px", boxSizing:"border-box" }}>
      <BeatLights metA={metA} metB={metB} runningA={runningA} runningB={runningB} measuresA={measuresA} measuresB={measuresB} enabled={showLightsFullscreen} />
      {showCircleFullscreen && (
        <div style={{ position:"fixed", inset:0, zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", background:"#15171c" }}>
          <div style={{ transform:"scale(1.7)" }}>
            <CircularVisualizer metA={metA} metB={metB} runningA={runningA} runningB={runningB} centerLabel={centerLabel} showSubtitle={false} showMcm={isPolimetria} />
          </div>
        </div>
      )}
      <FlashToggle on={flashOn} onToggle={() => setFlashOn((v) => !v)}
        viz={fullscreenViz} onVizToggle={() => setFullscreenViz((v) => (v === "lights" ? "circle" : "lights"))}
        showVizOption={canShowCircleFullscreen} />
      {(isMetrica || isPolimetria) && <TapTempoButton onTap={isMetrica ? handleGlobalTap : handlePolyTap} />}
      <DualSwitch on={dualOn} onToggle={toggleDual} />
      {performanceMode && practiceStatus.timerOn && (
        <div style={{
          position:"fixed", bottom:24, left:20, zIndex:1000,
          fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700,
          color:"#ffd04a", textShadow:"0 1px 6px rgba(0,0,0,0.7)", pointerEvents:"none",
        }}>{fmtMMSS(practiceStatus.timerLeft)}</div>
      )}

      {!performanceMode && (
      <>
      {/* header */}
      <div style={{ textAlign:"center", marginBottom:18 }}>
        <h1 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700, color:"#eee", margin:0, letterSpacing:4 }}>
          DUAL <span style={{ color:"#ff6b4a" }}>PUL</span><span style={{ color:"#4ad9ff" }}>SE</span>
        </h1>
      </div>

      {/* mode selector */}
      <div style={{ marginBottom:20 }}>
        <ModeSelector mode={mode} setMode={handleModeChange} />
      </div>

      {/* ── DUAL SINC (polirritmia) ── */}
      {isMetrica && (
        <>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:18 }}>
            <CircularVisualizer metA={metA} metB={metB} runningA={runningA} runningB={runningB} centerLabel={centerLabel} showSubtitle={false} showMcm={false} />
          </div>
          <div style={{ marginBottom:20 }}>
            <PoliPanel
              bpmBase={relBpmBase} base={relBase} derivado={relDeriv}
              onBpmBase={handleRelBpmBase} onBase={handleRelBase} onDeriv={handleRelDeriv}
            />
          </div>
          <SyncControls metA={metA} metB={metB} onChangeA={changeMetA} onChangeB={changeMetB} />
          <div style={{ maxWidth:680, margin:"0 auto 90px" }}>
            <PracticePanel onBpmChange={handlePracticeBpm} onActivate={handlePracticeActivate} running={runningA && runningB} onFinish={hardStop} status={practiceStatus} onStatus={updatePracticeStatus} />
          </div>
        </>
      )}

      {/* ── POLIMETRÍA (tercer modo) ── */}
      {isPolimetria && (
        <>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:18 }}>
            <CircularVisualizer metA={metA} metB={metB} runningA={runningA} runningB={runningB} centerLabel={centerLabel} showSubtitle={false} />
          </div>
          <div style={{ marginBottom:20 }}>
            <PolyMetriaPanel
              bpm={polyBpm} beatsA={polyBeatsA} beatsB={polyBeatsB}
              onBpm={handlePolyBpm} onBeatsA={handlePolyBeatsA} onBeatsB={handlePolyBeatsB}
            />
          </div>
          <SyncControls metA={metA} metB={metB} onChangeA={changeMetA} onChangeB={changeMetB} />
          <div style={{ maxWidth:680, margin:"0 auto 90px" }}>
            <PracticePanel onBpmChange={handlePracticeBpm} onActivate={handlePracticeActivate} running={runningA && runningB} onFinish={hardStop} status={practiceStatus} onStatus={updatePracticeStatus} />
          </div>
        </>
      )}

      {/* ── DUAL LIBRE ── */}
      {mode === "libre" && (
        <>
          <div style={{ display:"flex", gap:20, flexWrap:"wrap", justifyContent:"center", maxWidth:880, margin:"0 auto" }}>
            <MetronomePanel color="A" state={metA} onChange={changeMetA} onTiempoChange={tiempoChangeA} running={runningA} onToggle={toggleA} measures={measuresA} />
            <MetronomePanel color="B" state={metB} onChange={changeMetB} onTiempoChange={tiempoChangeB} running={runningB} onToggle={toggleB} measures={measuresB} />
          </div>
          <div style={{ maxWidth:880, margin:"22px auto 90px" }}>
            <PracticePanel onBpmChange={handlePracticeBpm} onActivate={handlePracticeActivate} running={runningA && runningB} onFinish={hardStop} status={practiceStatus} onStatus={updatePracticeStatus} />
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}
