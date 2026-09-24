import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Play, Square, Volume2, VolumeX, ChevronRight, Lightbulb } from "lucide-react";
// phase/cycle math lives in its own module so it can be unit-tested — see phase.test.js
import { lcm, polyCycleTarget, libreCycleTargets, cycleIndex, cycleRemaining, isSyncPulse, derivedBpm, reduceRatio, perceptualBand, accentSet, groupsFromIndices, effectiveGroups } from "./phase.js";
import { loadSettings, saveSettings } from "./settings.js";
// secuencia de compases (pestaña SECUENCIA de PRÁCTICA) — cálculo puro, testeable
import { pulseAt, sequenceLabel, normalizeSequence, normalizeStep, normalizePresets, savePreset, deletePreset, DEFAULT_SEQUENCE, DEN_VALUES, MAX_NUM } from "./sequence.js";
import { exportForState, downloadMidi } from "./midiExport.js";
// geometría del visualizador de árbol — cálculo puro, testeable
import { treeLayout, activePath, leafRadius, RADIO } from "./tree.js";
// fichas de movimiento y el búfer que sincroniza el dibujo con el audio
import { DUR, EASE, salida, decay, crearBuffer, anotarPulso, limpiarBuffer, pulsoEn, fraccionEntrePulsos, movimientoReducido } from "./motion.js";
// fichas visuales: tipografía, espaciado y color, en un solo sitio
import { FS, SP, TX, BG, VOZ, RAD, etiqueta, ANCHO, TRANSPORTE } from "./ui.js";

// ─── constants ────────────────────────────────────────────────────────────────
const beatsPerMeasure = (sig) => parseInt(sig.split("/")[0]);
// effectiveGroups vive en phase.js: el scheduler y la exportación a .mid leen
// la agrupación con la misma función, no con dos copias que pueden divergir.
const fmtMMSS = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

const SOUNDS = [
  { key:"click", label:"CLICK" }, { key:"beep",  label:"BEEP"  },
  { key:"wood",  label:"WOOD"  }, { key:"clave", label:"CLAVE" },
  { key:"rim",   label:"RIM"   }, { key:"hat",   label:"HAT"   },
];

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// Rango continuo 2..21. Antes la lista saltaba el 10, el 12 y el 14, así que no
// se podía armar un 12 (blues en 12/8, 6/8 agrupado) ni un 10. Y las métricas
// aksak reales llegan a 11, 13, 15 y 25 (kopanitsa búlgara), así que el techo
// de 21 no es un capricho.
const PULSE_VALUES  = range(2, 21); // relación A:B y pulsos por compás
const FIGURE_VALUES = range(1, 21); // subdivisión del pulso — el 1 es "sin subdividir"

// Cambios que obligan a rehacer la grilla desde cero. El BPM ya NO está aquí: se
// aplica de forma continua con rescaleGrid(), sin cortar el audio. Tenerlo
// afuera es además la defensa contra el único caso que rompe el reescalado —
// cambiar compás y tempo en el mismo movimiento, donde el factor deja de ser
// común a las dos voces.
const NEEDS_RESTART = new Set(["timeSig", "subdivision"]);

// Cuánto agenda el scheduler por adelantado. rescaleGrid() ancla el cambio de
// tempo más allá de este horizonte para no pisar pulsos que ya salieron.
const LOOKAHEAD = 0.1;

// Niveles relativos al volumen del pulso. Antes la subdivisión sonaba idéntica
// al pulso que divide, con lo cual no se distinguía el tiempo de sus divisiones
// y la subdivisión no cumplía su propósito.
const SUB_ACCENT_LEVEL = 0.75; // subdivisión que abre grupo
const SUB_LEVEL        = 0.45; // subdivisión normal

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

// ─── number select ────────────────────────────────────────────────────────────
// Reemplaza las grillas de botones numéricos. Con 20 valores la grilla ocupaba
// dos filas y empujaba el panel de práctica fuera de la pantalla; un <select>
// es un solo control, se elige escribiendo la cifra con el teclado y no admite
// valores inválidos.
function NumberSelect({ label, value, values, onChange, accent }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:SP.sm }}>
      {label && (
        <span style={etiqueta()}>{label}</span>
      )}
      <select value={value} onChange={(e) => onChange(parseInt(e.target.value))} style={{
        background:"#252830", border:`1px solid ${accent}`, borderRadius:RAD.sm, color:accent,
        fontFamily:"'JetBrains Mono',monospace", fontSize:FS.body, fontWeight:700,
        padding:"6px 10px", outline:"none", cursor:"pointer", minWidth:66,
      }}>
        {values.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
}

// ─── mode selector ────────────────────────────────────────────────────────────
function ModeSelector({ mode, setMode }) {
  return (
    <div style={{ display:"flex", background:"#1a1c22", borderRadius:RAD.md, padding:3, maxWidth:ANCHO, margin:"0 auto", gap:SP.xs }}>
      {[["metrica","DUAL SINC","#a78bfa"],["libre","DUAL TEMPO","#ffd04a"],["polimetria","DUAL POLY","#4aff9a"]].map(([k, lbl, color]) => {
        const on = mode === k;
        return (
          <button key={k} onClick={() => setMode(k)} style={{
            flex:1, background: on ? `${color}1a` : "none",
            border:`1px solid ${on ? color : "transparent"}`,
            borderRadius:RAD.sm, color: on ? color : "#444",
            fontFamily:"'JetBrains Mono',monospace", fontSize:FS.micro,
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

// point on a circle at fraction frac (0-1) of a lap, starting at 12 o'clock.
// ccw=true traces the lap counter-clockwise (opposite of A/B's own ring fill).
function circlePoint(cx, cy, r, frac, ccw) {
  const theta = (ccw ? -frac : frac) * 2 * Math.PI;
  return [cx + r * Math.sin(theta), cy - r * Math.cos(theta)];
}
// SVG arc path from 12 o'clock growing to fraction frac (0-1)
function cycleArcPath(cx, cy, r, frac, ccw) {
  const f = Math.min(Math.max(frac, 0.0001), 0.9999);
  const [x0, y0] = [cx, cy - r];
  const [x1, y1] = circlePoint(cx, cy, r, f, ccw);
  const largeArc = f > 0.5 ? 1 : 0;
  const sweep = ccw ? 0 : 1;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} ${sweep} ${x1} ${y1}`;
}

// mcm(A,B) tick ring — makes visible the shared grid every polyrhythm A:B
// resolves into (C1: "toda polirritmia A:B se resuelve con una grilla común
// de mcm(A,B) unidades"). A tick lights up in A's color every mcm/totalA
// slots, in B's color every mcm/totalB slots, and gold where both land.
// Capped past mcm=60 to avoid a ring so dense it reads as a solid line.
function mcmGrid(lcmAB, totalA, totalB, r, cx, cy, CA, CB) {
  if (!lcmAB || lcmAB > 60) return null;
  const stepA = lcmAB / totalA, stepB = lcmAB / totalB;
  return (
    <g>
      {Array.from({ length: lcmAB }, (_, i) => {
        const onA = i % stepA === 0, onB = i % stepB === 0;
        if (!onA && !onB) return null;
        const color = onA && onB ? "#ffd75e" : onA ? CA : CB;
        const len = onA && onB ? 8 : 5;
        const a = (i / lcmAB) * 2 * Math.PI - Math.PI / 2;
        const x0 = cx + (r - len) * Math.cos(a), y0 = cy + (r - len) * Math.sin(a);
        const x1 = cx + (r + len) * Math.cos(a), y1 = cy + (r + len) * Math.sin(a);
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth={onA && onB ? 2.5 : 1.5} opacity={0.85} />;
      })}
    </g>
  );
}

// El collar: el polígono del compás, su estela y el punto que viaja. La estela y
// el punto los mueve el bucle del reloj de audio por estos dos refs, así que acá
// no hay nada que se vuelva a montar en cada pulso.
function Collar({ points, color, estela, cabeza }) {
  const d = points.map((p) => p.join(",")).join(" ");
  const [tx, ty] = points[0]; // downbeat vertex — always marked, never animated away
  return (
    <>
      <polygon points={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" opacity={0.18} />
      <polygon ref={estela} points={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round"
        pathLength={1} strokeDasharray={1} strokeDashoffset={1}
        style={{ filter:`drop-shadow(0 0 6px ${color})`, willChange:"stroke-dashoffset" }} />
      <polygon points={`${tx},${ty - 7} ${tx + 6},${ty + 5} ${tx - 6},${ty + 5}`} fill={color}
        style={{ filter:`drop-shadow(0 0 7px ${color})` }} />
      <circle ref={cabeza} cx={tx} cy={ty} r={5.5} fill="#fff"
        style={{ filter:"drop-shadow(0 0 8px #fff)", willChange:"cx, cy" }} />
    </>
  );
}

function CircularVisualizer({
  metA, metB, runningA, runningB, centerLabel, showSubtitle, showMcm = true,
  // overrides let Dual Libre drive the visual off its subdivision/subTick
  // instead of timeSig/beat (which are always 1 in that mode)
  // El índice del pulso y la fracción del ciclo ya no llegan por props: los lee
  // el bucle del reloj de audio. Quedan los totales, que definen el dibujo.
  totalAOverride, totalBOverride,
  // vizStyle is controlled from the parent — this wrapper always has a CSS
  // transform (for the beat pulse), which creates a containing block for
  // position:fixed children, so the toggle button can't live in here
  vizStyle, fullscreen,
  // el árbol dibuja desde el reloj del audio, así que necesita el contexto y los búferes
  ctxRef, pulsosA, pulsosB,
  // phase-sync cycle ring (Dual Libre / Dual Poly only) — real pulse counts,
  // never a wall-clock timer. Two targets/counts because Libre's A and B
  // realign on different pulse counts of their own (though at the same instant).
  showCycleRing, cycleTargetA, cycleTargetB, cyclePulseA, cyclePulseB,
}) {
  const totalA = totalAOverride ?? beatsPerMeasure(metA.timeSig);
  const totalB = totalBOverride ?? beatsPerMeasure(metB.timeSig);
  const lcmAB  = lcm(totalA, totalB);
  const CA = "#ff6b4a", CB = "#4ad9ff";
  const S = 320, cx = 160, cy = 160, rA = 128, rB = 84, rCycle = rA + 20;

  // sync ring: follows A's or B's real pulses (tap the playhead to switch).
  // Pulse 1 is the reference click where A and B start aligned, so it sits
  // AT the top (index 0) — the ring then fills and only returns to the top
  // on the pulse that actually lands back in phase (index 0 again).
  const [syncSource, setSyncSource] = useState("A");
  const cycleTarget = syncSource === "A" ? cycleTargetA : cycleTargetB;
  const cyclePulse  = syncSource === "A" ? cyclePulseA  : cyclePulseB;
  const idx = cycleIndex(cyclePulse, cycleTarget);
  const cycleFrac = cycleTarget ? idx / cycleTarget : 0;
  const remainingPulses = cycleRemaining(cyclePulse, cycleTarget);
  const atSync = !!showCycleRing && isSyncPulse(cyclePulse, cycleTarget);

  // brief shared glow on A and B rings the instant the cycle actually closes
  const [syncFlash, setSyncFlash] = useState(false);
  useEffect(() => {
    if (!atSync) return;
    // El setState va en un callback y no en el cuerpo del efecto: llamarlo
    // derecho acá encadena renders, y era uno de los errores que marcaba el lint.
    let apagar;
    const prender = setTimeout(() => {
      setSyncFlash(true);
      apagar = setTimeout(() => setSyncFlash(false), 400);
    }, 0);
    return () => { clearTimeout(prender); clearTimeout(apagar); };
  }, [atSync]);

  const pointsA = polyPoints(totalA, rA, cx, cy);
  const pointsB = polyPoints(totalB, rB, cx, cy);

  // ── el motor: mismo reloj que el sonido ─────────────────────────────────────
  // Igual que el árbol. El scheduler anota cada pulso con el `t` del audio y acá
  // se lee `ctx.currentTime` para saber dónde estamos. Antes el pulso activo
  // llegaba por estado de React desde un `setTimeout` del scheduler —dos relojes
  // distintos— y el collar hacía un setState por cuadro, sesenta por segundo.
  const puntosA = useRef([]), puntosB = useRef([]);
  const haloA  = useRef(null), haloB  = useRef(null);
  const arcoA  = useRef(null), arcoB  = useRef(null);
  const estelaA = useRef(null), estelaB = useRef(null);
  const cabezaA = useRef(null), cabezaB = useRef(null);
  const ondaA  = useRef(null), ondaB  = useRef(null);
  const marco  = useRef(null);

  // Los totales cambian con la secuencia y con el modo, así que viajan por un
  // ref que se refresca en cada render: si el bucle dependiera de ellos se
  // desmontaría en cada cambio de compás.
  const vista = useRef({ totalA, totalB, pointsA, pointsB, subA: false, subB: false });
  useEffect(() => {
    vista.current = { totalA, totalB, pointsA, pointsB,
                      subA: totalAOverride != null, subB: totalBOverride != null };
  });

  useEffect(() => {
    if (movimientoReducido()) return;
    if (!runningA && !runningB) return;
    if (vizStyle === "tree") return;
    let raf;
    const vida = DUR.slow / 1000;
    const elMarco = marco.current;   // copiado acá: en la limpieza el ref ya pudo cambiar

    // Qué pulso suena, cuánto le queda de brillo, y en qué punto del ciclo
    // estamos. Con override —DUAL LIBRE— el búfer guarda un pulso por tiempo y
    // la estructura dibujada es la subdivisión, así que el índice sale de
    // repartir `paso` en `total` partes iguales.
    const leer = (buf, total, usaSub) => {
      const ctx = ctxRef?.current;
      if (!ctx || ctx.state === "closed") return null;
      const ahora = ctx.currentTime;
      const hit = pulsoEn(buf.current, ahora);
      if (!hit) return null;
      if (usaSub) {
        const paso = hit.pulso.paso;
        if (!(paso > 0) || !(total > 0)) return null;
        const sub = paso / total;
        const i = Math.min(total - 1, Math.floor(hit.desde / sub));
        return { activo: i, brillo: decay(hit.desde - i * sub, Math.min(vida, sub)),
                 frac: Math.min(1, hit.desde / paso) };
      }
      const tot = Math.max(1, hit.pulso.total || total);
      const f = fraccionEntrePulsos(buf.current, ahora);
      return { activo: Math.min(total - 1, hit.pulso.idx), brillo: decay(hit.desde, vida),
               frac: ((hit.pulso.idx + f) % tot) / tot };
    };

    const pintar = (lect, puntos, halo, arco, estela, cabeza, onda, pts, r) => {
      const act = lect && lect.brillo > 0 ? lect.activo : -1;

      for (let i = 0; i < puntos.current.length; i++) {
        const el = puntos.current[i];
        if (!el) continue;
        const on = i === act;
        // escala, no radio: el radio obliga a repintar y la escala no
        const k = on ? 1 + lect.brillo * 0.5 : 1;
        el.setAttribute("transform", `translate(${el.dataset.cx} ${el.dataset.cy}) scale(${k.toFixed(3)}) translate(-${el.dataset.cx} -${el.dataset.cy})`);
        el.setAttribute("fill", on ? el.dataset.vivo : el.dataset.base);
      }

      // Un solo halo por voz que se muda al pulso que suena, en vez de dos
      // círculos que se montaban y desmontaban en cada golpe.
      if (halo.current) {
        if (act >= 0 && pts[act]) {
          const [hx, hy] = pts[act];
          halo.current.setAttribute("transform", `translate(${hx} ${hy}) scale(${(0.6 + (1 - lect.brillo) * 1.4).toFixed(3)}) translate(${-hx} ${-hy})`);
          halo.current.setAttribute("cx", hx);
          halo.current.setAttribute("cy", hy);
          halo.current.setAttribute("opacity", (lect.brillo * 0.45).toFixed(3));
        } else {
          halo.current.setAttribute("opacity", 0);
        }
      }

      const frac = lect ? lect.frac : 0;
      // el arco se llena con la fracción real del compás, no con una animación
      // de CSS de duración fija que se reiniciaba remontando el elemento
      if (arco.current) arco.current.setAttribute("stroke-dashoffset", (1 - frac).toFixed(4));
      if (estela.current) estela.current.setAttribute("stroke-dashoffset", (1 - frac).toFixed(4));
      if (cabeza.current && pts.length) {
        const [dx, dy] = pointAtT(pts, frac);
        cabeza.current.setAttribute("cx", dx.toFixed(2));
        cabeza.current.setAttribute("cy", dy.toFixed(2));
      }
      // la onda sale del 1, y se apaga creciendo
      if (onda.current) {
        if (act === 0 && lect.brillo > 0) {
          const s = 1 + (1 - lect.brillo) * 3.2;
          onda.current.setAttribute("transform", `translate(${cx} ${cy - r}) scale(${s.toFixed(3)}) translate(${-cx} ${-(cy - r)})`);
          onda.current.setAttribute("opacity", (lect.brillo * 0.8).toFixed(3));
        } else {
          onda.current.setAttribute("opacity", 0);
        }
      }
      return act === 0 ? (lect ? lect.brillo : 0) : 0;
    };

    const tick = () => {
      if (!document.hidden) {
        const v = vista.current;
        const la = runningA ? leer(pulsosA, v.totalA, v.subA) : null;
        const lb = runningB ? leer(pulsosB, v.totalB, v.subB) : null;
        const ga = pintar(la, puntosA, haloA, arcoA, estelaA, cabezaA, ondaA, v.pointsA, rA);
        const gb = pintar(lb, puntosB, haloB, arcoB, estelaB, cabezaB, ondaB, v.pointsB, rB);
        // el latido del marco: el 1 de cualquiera de las dos voces
        if (marco.current) {
          const g = Math.max(ga, gb);
          marco.current.style.transform = `scale(${(1 + g * 0.035).toFixed(4)})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Al parar, el último cuadro quedaba congelado con un punto encendido y su
    // halo abierto. Se apaga todo a mano, que es lo que antes hacía React al
    // volver a pintar.
    return () => {
      cancelAnimationFrame(raf);
      for (const p of [puntosA, puntosB]) {
        for (const el of p.current) {
          if (!el) continue;
          el.setAttribute("transform", `translate(${el.dataset.cx} ${el.dataset.cy}) scale(1) translate(-${el.dataset.cx} -${el.dataset.cy})`);
          el.setAttribute("fill", el.dataset.base);
        }
      }
      for (const r of [haloA, haloB, ondaA, ondaB]) r.current?.setAttribute("opacity", 0);
      if (elMarco) elMarco.style.transform = "scale(1)";
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningA, runningB, vizStyle]);

  // Los puntos del aro los enciende el bucle, no React: cada uno lleva su
  // posición y sus dos colores en `data-*` y nunca se vuelve a montar.
  const ring = (total, r, color, puntos, halo) => {
    const dr = total <= 8 ? 12 : total <= 12 ? 9 : 7;
    return (
      <>
        <circle ref={halo} cx={cx} cy={cy - r} r={dr + 16} fill={`${color}44`} opacity={0}
          style={{ willChange:"transform, opacity" }} />
        {Array.from({ length:total }, (_, i) => {
          const a = (i / total) * 2 * Math.PI - Math.PI / 2;
          const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
          const base = i === 0 ? `${color}dd` : `${color}88`;
          return (
            <circle key={i} ref={(el) => { puntos.current[i] = el; }}
              cx={x} cy={y} r={i === 0 ? dr + 3 : dr} fill={base}
              data-cx={x} data-cy={y} data-base={base} data-vivo={color}
              style={{ willChange:"transform" }} />
          );
        })}
      </>
    );
  };

  const label = centerLabel ?? `${totalA}:${totalB}`;

  // El árbol es otro dibujo de lo mismo, no otro sitio de montaje: se devuelve
  // desde acá para que los tres modos y la pantalla completa lo hereden sin
  // repetir la elección cinco veces. Va después de todos los hooks de arriba,
  // que por eso no se pueden mover debajo de este return.
  if (vizStyle === "tree") {
    return (
      <TreeVisualizer metA={metA} metB={metB} runningA={runningA} runningB={runningB} fullscreen={fullscreen}
        ctxRef={ctxRef} pulsosA={pulsosA} pulsosB={pulsosB}
        totalAOverride={totalAOverride} totalBOverride={totalBOverride}
        groupsAOverride={metA.subAccents} groupsBOverride={metB.subAccents} />
    );
  }

  return (
    <div ref={marco} style={{
      display:"flex", flexDirection:"column", alignItems:"center", gap:SP.md,
      width:"100%", maxWidth:460,
      transform:"scale(1)", willChange:"transform",
    }}>
      <div style={{ position:"relative", width:"100%", maxWidth:460, display:"flex", justifyContent:"center" }}>
        <div style={{
          position:"absolute", inset:-30, borderRadius:"50%",
          background: `radial-gradient(circle, ${syncFlash ? "#ffffff22" : `${CA}14`} 0%, transparent 70%)`,
          transition:"background 0.3s", pointerEvents:"none",
        }} />
        <svg width={fullscreen ? "82vmin" : "100%"} height={fullscreen ? "82vmin" : undefined} viewBox={`0 0 ${S} ${S}`} style={{ overflow:"visible", position:"relative", maxWidth:460, display:"block" }}>
          <defs>
            <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={syncFlash ? "#ffffff33" : "#ffffff0a"} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={rA+4} fill="url(#centerGlow)" />
          {vizStyle === "rings" && (runningA || runningB) && (
            <circle cx={cx} cy={cy} r={rA + 16} fill="none" stroke="#ffffff18" strokeWidth={1} strokeDasharray="2 10"
              style={{ transformOrigin:`${cx}px ${cy}px`, animation:"slowSpin 18s linear infinite" }} />
          )}
          {showCycleRing && cycleTarget > 0 && (
            <>
              <circle cx={cx} cy={cy} r={rCycle} fill="none" stroke="#BA751733" strokeWidth={2} />
              {cycleFrac > 0 && (
                <path d={cycleArcPath(cx, cy, rCycle, cycleFrac, false)} fill="none"
                  stroke={syncSource === "A" ? CA : CB} strokeWidth={remainingPulses <= 2 ? 4 : 2} strokeLinecap="round"
                  style={{ filter: remainingPulses <= 2 ? `drop-shadow(0 0 6px ${syncSource === "A" ? CA : CB})` : "none" }} />
              )}
              {(() => {
                const [px, py] = circlePoint(cx, cy, rCycle, cycleFrac, false);
                return (
                  <circle cx={px} cy={py} r={6.5} fill={syncSource === "A" ? CA : CB}
                    stroke="#15171c" strokeWidth={2} style={{ cursor:"pointer" }}
                    onClick={() => setSyncSource((s) => (s === "A" ? "B" : "A"))} />
                );
              })()}
            </>
          )}
          <circle cx={cx} cy={cy} r={rA} fill="none" stroke={`${CA}77`} strokeWidth={3} />
          <circle cx={cx} cy={cy} r={rB} fill="none" stroke={`${CB}77`} strokeWidth={3} />
          {mcmGrid(lcmAB, totalA, totalB, rA + 10, cx, cy, CA, CB)}
          {syncFlash && (
            <>
              <circle cx={cx} cy={cy} r={rA} fill="none" stroke="#EF9F27" strokeWidth={5} style={{ filter:"drop-shadow(0 0 14px #EF9F27)" }} />
              <circle cx={cx} cy={cy} r={rB} fill="none" stroke="#EF9F27" strokeWidth={5} style={{ filter:"drop-shadow(0 0 14px #EF9F27)" }} />
            </>
          )}
          {vizStyle === "rings" && runningA && (
            <circle ref={arcoA} cx={cx} cy={cy} r={rA} fill="none" stroke={CA} strokeWidth={4}
              strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ filter:`drop-shadow(0 0 5px ${CA})`, willChange:"stroke-dashoffset" }} />
          )}
          {vizStyle === "necklace" && runningA && (
            <Collar points={pointsA} color={CA} estela={estelaA} cabeza={cabezaA} />
          )}
          {ring(totalA, rA, CA, puntosA, haloA)}
          {vizStyle === "rings" && runningB && (
            <circle ref={arcoB} cx={cx} cy={cy} r={rB} fill="none" stroke={CB} strokeWidth={4}
              strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ filter:`drop-shadow(0 0 5px ${CB})`, willChange:"stroke-dashoffset" }} />
          )}
          {vizStyle === "necklace" && runningB && (
            <Collar points={pointsB} color={CB} estela={estelaB} cabeza={cabezaB} />
          )}
          {ring(totalB, rB, CB, puntosB, haloB)}
          {vizStyle === "rings" && runningA && (
            <circle ref={ondaA} cx={cx} cy={cy - rA} r={5} fill="none" stroke={CA} strokeWidth={2.5}
              opacity={0} style={{ willChange:"transform, opacity" }} />
          )}
          {vizStyle === "rings" && runningB && (
            <circle ref={ondaB} cx={cx} cy={cy - rB} r={5} fill="none" stroke={CB} strokeWidth={2.5}
              opacity={0} style={{ willChange:"transform, opacity" }} />
          )}
          <text x={cx} y={showMcm ? cy - 10 : cy + 10} textAnchor="middle"
            fill={syncFlash ? "#fff" : "#ddd"} fontSize={30}
            fontFamily="'JetBrains Mono',monospace" fontWeight="800"
            style={{ transition:"fill 0.2s", filter: syncFlash ? "drop-shadow(0 0 10px #fff)" : "none" }}>{label}</text>
          {showMcm && (
            <text x={cx} y={cy+13} textAnchor="middle" fill="#999" fontSize={11} fontFamily="monospace" fontWeight="600">
              MCM {lcmAB} · A cada {lcmAB / totalA} · B cada {lcmAB / totalB}
            </text>
          )}
        </svg>
      </div>
      {showSubtitle !== false && (
        <div style={{ fontFamily:"monospace", fontSize:FS.small, color:TX.faint, textAlign:"center" }}>
          Polimetría {totalA} contra {totalB}
          <span style={{ margin:"0 8px", color:TX.muted }}>·</span>
          Coinciden cada{" "}
          <span style={{ color:"#ccc", fontWeight:700 }}>{lcmAB}</span> pulsos
        </div>
      )}
    </div>
  );
}

// ─── visualizador de árbol ────────────────────────────────────────────────────
// La métrica dibujada como un árbol: la raíz es el compás entero, el nivel del
// medio son los grupos de la agrupación aditiva, y las hojas son los pulsos.
//
// A crece hacia arriba y B hacia abajo, las dos apoyadas sobre una misma barra
// de tiempo. Eso es lo que hace visible el cruce: los 7 pulsos de A y los 5 de
// B caen sobre la misma barra, y se ve dónde coinciden y dónde no. Con la
// secuencia encendida el compás cambia paso a paso y el árbol lo sigue solo,
// porque lee timeSig y accentGroups, que el scheduler ya mantiene al día.
// Dibuja leyendo ctx.currentTime, el MISMO reloj con el que suena, y escribe
// directo en los nodos del SVG por ref. Por eso no hay un re-render de React
// por pulso: a 21 pulsos por compás y dos voces, eso era lo que producía el
// tirón. Y por eso la imagen no se despega del audio: no hay dos relojes.
//
// Todo lo que se mueve lo hace con transform y opacity, que el navegador puede
// componer sin volver a pintar. Nada de `r`, `stroke-width` ni `drop-shadow`
// por elemento, que era lo que había antes.
function TreeVisualizer({ metA, metB, runningA, runningB, fullscreen, ctxRef, pulsosA, pulsosB,
  // En DUAL TEMPO el compás es de un solo pulso: lo que tiene estructura ahí es
  // la subdivisión, igual que en el círculo. Sin esto el árbol mostraba una
  // hoja suelta y no decía nada.
  totalAOverride, totalBOverride, groupsAOverride, groupsBOverride }) {
  const S = 680, H = 470;
  const X0 = 60, X1 = 620, BAR = 235;
  const CA = "#ff6b4a", CB = "#4ad9ff", HOT = "#4aff9a";

  const ramaA = useRef(null), ramaB = useRef(null);
  const hojasA = useRef([]),  hojasB = useRef([]);
  const haloA = useRef(null), haloB = useRef(null);
  const barrido = useRef(null);

  const plan = (met, totalOv, groupsOv) => {
    const usaSub = totalOv != null;
    const total  = Math.max(1, usaSub ? totalOv : beatsPerMeasure(met.timeSig));
    const layout = treeLayout(total, usaSub ? groupsOv : met.accentGroups, { x0: X0, x1: X1 });
    return { total, layout, r: leafRadius(total, X0, X1), usaSub,
             etiqueta: usaSub ? `1/${total}` : met.timeSig };
  };
  const pa = plan(metA, totalAOverride, groupsAOverride);
  const pb = plan(metB, totalBOverride, groupsBOverride);
  // hasta dónde llega el dibujo: el último pulso de la voz que más extiende
  const ultimo = (p) => p.layout.leaves[p.layout.leaves.length - 1].x;
  const finX = Math.max(ultimo(pa), ultimo(pb), X0 + 1);
  // El scheduler reescribe accentGroups en cada pulso con un array NUEVO, así
  // que si el bucle dependiera de él se desmontaría y volvería a montar en cada
  // pulso, y nunca llegaría a dibujar. El plan viaja por un ref que se refresca
  // en cada render, y el bucle vive mientras haya algo sonando.
  const planRef = useRef({ pa, pb });
  useEffect(() => { planRef.current = { pa, pb }; });

  // ── el bucle de dibujo ──────────────────────────────────────────────────────
  useEffect(() => {
    if (movimientoReducido()) return;           // regla `reduced-motion`
    if (!runningA && !runningB) return;
    let raf;
    const vida = DUR.slow / 1000;

    const pintarVoz = (buf, plan_, hojas, halo, rama, arriba) => {
      const ctx = ctxRef?.current;
      if (!ctx || ctx.state === "closed") return;
      const hit = pulsoEn(buf.current, ctx.currentTime);
      const brillo = hit ? decay(hit.desde, vida) : 0;
      const activo = hit && brillo > 0 ? hit.pulso.idx : -1;

      for (let i = 0; i < hojas.current.length; i++) {
        const el = hojas.current[i];
        if (!el) continue;
        const on = i === activo;
        // escala en vez de radio: el radio obliga a repintar, la escala no
        const k = on ? 1 + brillo * 0.9 : 1;
        el.setAttribute("transform", `translate(${el.dataset.cx} ${el.dataset.cy}) scale(${k.toFixed(3)}) translate(-${el.dataset.cx} -${el.dataset.cy})`);
        el.setAttribute("opacity", on ? 1 : 0.5);
        if (on) el.setAttribute("fill", HOT);
        else el.setAttribute("fill", el.dataset.base);
      }

      if (halo.current) {
        const h = halo.current;
        if (activo >= 0) {
          const cx = plan_.layout.leaves[activo].x;
          const cy = BAR + (arriba ? -12 : 12);
          h.setAttribute("cx", cx);
          h.setAttribute("cy", cy);
          // el halo crece mientras se apaga: es la onda del golpe
          h.setAttribute("transform", `translate(${cx} ${cy}) scale(${(0.5 + (1 - brillo) * 1.1).toFixed(3)}) translate(${-cx} ${-cy})`);
          h.setAttribute("opacity", (brillo * 0.5).toFixed(3));
        } else {
          h.setAttribute("opacity", 0);
        }
      }

      if (rama.current) {
        rama.current.setAttribute("opacity", brillo.toFixed(3));
        if (activo >= 0) {
          const path = activePath(plan_.layout, activo);
          if (path) {
            const dir = arriba ? -1 : 1;
            const yH = BAR + dir * 12, yG = BAR + dir * 105, yR = BAR + dir * 175;
            rama.current.setAttribute("d",
              `M ${(X0 + finX) / 2} ${yR - dir * RADIO.raiz} L ${path.groupX} ${yG + dir * RADIO.grupo} M ${path.groupX} ${yG - dir * RADIO.grupo} L ${path.leafX} ${yH + dir * plan_.r}`);
          }
        }
      }
    };

    const tick = () => {
      if (!document.hidden) {
        if (runningA) pintarVoz(pulsosA, planRef.current.pa, hojasA, haloA, ramaA, true);
        if (runningB) pintarVoz(pulsosB, planRef.current.pb, hojasB, haloB, ramaB, false);
        const ctx = ctxRef?.current;
        if (barrido.current && ctx && ctx.state !== "closed") {
          const hit = pulsoEn(pulsosA.current, ctx.currentTime);
          const f = hit ? Math.min(1, hit.pulso.idx / Math.max(1, hit.pulso.total)) : 0;
          barrido.current.setAttribute("opacity", (0.25 + f * 0.35).toFixed(3));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningA, runningB]);

  const voz = (met, p, arriba, hojas, halo, rama) => {
    const { layout, r } = p;
    const centro = (X0 + finX) / 2;   // centro real de lo dibujado
    const color = arriba ? CA : CB;
    const dir   = arriba ? -1 : 1;
    const yHoja = BAR + dir * 14, yGrupo = BAR + dir * 102, yRaiz = BAR + dir * 190;
    hojas.current = [];

    return (
      <g>
        {layout.groups.map((g, i) => (
          <line key={`gr${i}`} x1={centro} y1={yRaiz - dir * RADIO.raiz} x2={g.x} y2={yGrupo + dir * RADIO.grupo}
            stroke={color} strokeWidth={2} opacity={0.4} />
        ))}
        {layout.groups.map((g, i) =>
          layout.leaves.slice(g.from, g.to + 1).map((h) => (
            <line key={`hj${i}-${h.i}`} x1={g.x} y1={yGrupo - dir * RADIO.grupo} x2={h.x} y2={yHoja + dir * r}
              stroke={color} strokeWidth={2} opacity={0.4} />
          ))
        )}

        {/* la onda del golpe: un círculo que crece mientras se apaga */}
        <circle ref={halo} cx={centro} cy={yHoja} r={r * 1.8} fill="none"
          stroke={HOT} strokeWidth={2} opacity={0} style={{ willChange:"transform, opacity" }} />

        {/* la rama que suena, encendida por el bucle */}
        <path ref={rama} d="" fill="none" stroke={HOT} strokeWidth={4}
          strokeLinecap="round" opacity={0} style={{ willChange:"opacity" }} />

        {layout.leaves.map((h) => {
          const abre = layout.groups.some((g) => g.from === h.i);
          const base = abre ? color : `${color}88`;
          return (
            <circle key={h.i} ref={(el) => { hojas.current[h.i] = el; }}
              cx={h.x} cy={yHoja} r={r} fill={base} opacity={0.5}
              data-cx={h.x} data-cy={yHoja} data-base={base} />
          );
        })}

        {layout.groups.map((g, i) => (
          <g key={`n${i}`}>
            <circle cx={g.x} cy={yGrupo} r={RADIO.grupo} fill="#1e2028" stroke={color} strokeWidth={2} />
            <text x={g.x} y={yGrupo + 4} textAnchor="middle" fontFamily="'JetBrains Mono',monospace"
              fontSize={12} fontWeight={700} fill={color}>{g.size}</text>
          </g>
        ))}

        <circle cx={centro} cy={yRaiz} r={RADIO.raiz} fill="#1e2028" stroke={color} strokeWidth={2.5} />
        <text x={centro} y={yRaiz + 5} textAnchor="middle" fontFamily="'JetBrains Mono',monospace"
          fontSize={FS.body} fontWeight={800} fill={color}>{p.etiqueta}</text>
      </g>
    );
  };

  return (
    <svg width={fullscreen ? "92vmin" : "100%"} height={fullscreen ? "82vmin" : undefined}
      viewBox={`0 0 ${S} ${H}`} style={{ maxWidth:ANCHO, overflow:"visible", display:"block" }}>
      {/* La barra termina en el último pulso y todo el dibujo se corre a la
          mitad del sobrante, así queda centrado. El último pulso nunca llega
          al final del compás —lo que sobra es su duración—, y dejar la barra
          estirada hasta ahí la descentraba respecto del árbol. */}
      <g transform={`translate(${(X1 - finX) / 2} 0)`}>
        <line ref={barrido} x1={X0} y1={BAR} x2={finX} y2={BAR}
          stroke="#7c3aed" strokeWidth={8} strokeLinecap="round" opacity={0.3}
          style={{ transition:`opacity ${salida(DUR.base)}ms ${EASE.sale}`, willChange:"opacity" }} />
        {voz(metA, pa, true,  hojasA, haloA, ramaA)}
        {voz(metB, pb, false, hojasB, haloB, ramaB)}
      </g>
    </svg>
  );
}

// ─── polimetría panel ─────────────────────────────────────────────────────────
function PoliPanel({ bpmBase, base, derivado, onBpmBase, onBase, onDeriv, onTap, metA, metB, onChangeA, onChangeB, bpmFlash, accentViewA, accentViewB }) {
  const ratio    = `${derivado}:${base}`;
  const bpmB     = derivedBpm(bpmBase, base, derivado);
  const fmtBpm   = (v) => Number.isInteger(v) ? v : v.toFixed(2);
  const reduced  = reduceRatio(derivado, base);
  const band     = perceptualBand(derivado, base);
  const bandLbl  = { integrable:"se integra como una figura", separable:"se oyen dos capas separadas", textura:"el oído deja de seguirlo, se oye como textura" }[band];
  const [open, setOpen] = useState(true);

  return (
    <div style={{ background:"#1e2028", borderRadius:RAD.lg, maxWidth:ANCHO, margin:"0 auto", border:"1px solid #252830" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width:"100%", background:"none", border:"none", cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px",
      }}>
        <span style={etiqueta()}>BPM Y RELACIÓN</span>
        <ChevronRight size={14} color={TX.muted} style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
      </button>
      <div style={{
        display: open ? "flex" : "none", flexDirection:"column", gap:SP.lg,
        padding:"0 24px 20px",
      }}>
      {/* BPM base */}
      <div>
        <div style={{ ...etiqueta(), marginBottom:SP.sm }}>BPM A</div>
        <div style={{ display:"flex", alignItems:"center", gap:SP.lg }}>
          <div style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:FS.hero, fontWeight:700, lineHeight:1, minWidth:96,
            color: bpmFlash ? "#ffd04a" : "#ff6b4a",
            textShadow: bpmFlash ? "0 0 18px #ffd04a" : "none",
            transition: bpmFlash ? "none" : "color 0.45s, text-shadow 0.45s",
          }}>
            {bpmBase}
          </div>
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:SP.sm }}>
            <input type="range" min={1} max={600} value={bpmBase}
              onChange={(e) => onBpmBase(parseInt(e.target.value))}
              style={{ width:"100%", accentColor:"#ff6b4a" }} />
            <button onClick={onTap} style={{ background:"#ff6b4a14", border:"1px solid #ff6b4a44", borderRadius:RAD.md, color:"#ff6b4a", fontFamily:"'JetBrains Mono',monospace", fontSize:FS.small, fontWeight:600, padding:"8px", cursor:"pointer", letterSpacing:1, marginTop:4 }}>TAP TEMPO</button>
            <div style={{ display:"flex", gap:SP.sm }}>
              {[-10,-1,+1,+10].map((d) => (
                <button key={d} onClick={() => onBpmBase(Math.min(600, Math.max(1, bpmBase + d)))} style={{
                  background:"#252830", border:"1px solid #ff6b4a33", borderRadius:RAD.sm,
                  color:"#ff6b4a", fontFamily:"monospace", fontSize:FS.small, padding:"4px 9px", cursor:"pointer",
                }}>{d > 0 ? `+${d}` : d}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* selectores y acentos — el acento vive junto al compás, porque en
          métrica aditiva el acento ES la métrica: un 8 sin acentuar es
          indistinguible de un 4/4 */}
      <div style={{ display:"flex", gap:SP.xl, flexWrap:"wrap" }}>
        {[
          { label:"A", accent:"#ff6b4a", val:base,     set:onBase,  met:metA, onChange:onChangeA },
          { label:"B", accent:"#4ad9ff", val:derivado, set:onDeriv, met:metB, onChange:onChangeB },
        ].map(({ label, accent, val, set, met, onChange }) => (
          <div key={label} style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column", gap:SP.md }}>
            <NumberSelect label={label} value={val} values={PULSE_VALUES} onChange={set} accent={accent} />
            <div>
              <div style={{ ...etiqueta(), marginBottom:SP.sm }}>
                ACENTOS{(label === "A" ? accentViewA : accentViewB) && (
                  <span style={{ color:"#ffd04a", marginLeft:6 }}>PASO {(label === "A" ? accentViewA : accentViewB).step}</span>
                )}
              </div>
              <AccentDots
                total={(label === "A" ? accentViewA : accentViewB)?.total ?? beatsPerMeasure(met.timeSig)}
                groups={(label === "A" ? accentViewA : accentViewB)?.groups ?? met.accentGroups}
                onChange={(g) => onChange({ accentGroups: g })} accent={accent} />
            </div>
          </div>
        ))}
      </div>

      {/* info */}
      <div style={{
        background:"#15171c", borderRadius:RAD.md, padding:"16px 20px",
        display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px 32px",
        border:"1px solid #252830",
      }}>
        <div>
          <div style={etiqueta()}>RELACIÓN</div>
          <div style={{ color:"#eee", fontFamily:"'JetBrains Mono',monospace", fontSize:FS.lead, fontWeight:700, marginTop:3 }}>{ratio}</div>
          {!reduced.isCoprime && (
            <div style={{ color:"#e0a030", fontSize:FS.micro, fontFamily:"monospace", marginTop:4 }}>
              = {reduced.num}:{reduced.den} — subdivisión, no polirritmia
            </div>
          )}
        </div>
        <div>
          <div style={etiqueta()}>BPM B</div>
          <div style={{ color:"#4ad9ff", fontFamily:"'JetBrains Mono',monospace", fontSize:FS.lead, fontWeight:700, marginTop:3 }}>{fmtBpm(bpmB)}</div>
        </div>
      </div>
      {reduced.isCoprime && (
        <div style={{ color:TX.faint, fontSize:FS.micro, fontFamily:"monospace", textAlign:"center" }}>
          {reduced.num}:{reduced.den} — {bandLbl}
        </div>
      )}
      </div>
    </div>
  );
}

// ─── sound select (dropdown) ──────────────────────────────────────────────────
function SoundSelect({ label, value, onChange, accent }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:SP.sm, flex:1, minWidth:120 }}>
      <span style={{ color:TX.muted, fontSize:FS.micro, fontFamily:"monospace", letterSpacing:1, minWidth:40 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        flex:1, background:"#252830", border:`1px solid ${accent}33`, borderRadius:RAD.sm,
        color:accent, fontFamily:"monospace", fontSize:FS.small, fontWeight:600,
        padding:"5px 8px", outline:"none", cursor:"pointer",
      }}>
        {SOUNDS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </div>
  );
}

// ─── metronome panel ──────────────────────────────────────────────────────────
function MetronomePanel({ color, state, onChange, running, onToggle, measures, bpmFlash, accentView }) {
  const { bpm, volume, muted, subTick, strongSound, weakSound, subdivision, subAccents } = state;
  const [soundOpen, setSoundOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const tapRef = useRef([]);
  const accent    = color === "A" ? "#ff6b4a" : "#4ad9ff";
  const dimAccent = color === "A" ? "#6a2a18" : "#174d5e";

  // Agrupación interna del pulso. effectiveGroups vuelve a plano solo si los
  // grupos guardados ya no suman la subdivisión actual, así que cambiar de
  // subdivisión no deja un patrón viejo que no entra.
  const subAccentIdx = accentSet(effectiveGroups(subAccents, subdivision));
  const toggleSubAccent = (i) => {
    if (i === 0) return; // el pulso siempre abre grupo
    const next = new Set(subAccentIdx);
    if (next.has(i)) next.delete(i); else next.add(i);
    onChange({ subAccents: groupsFromIndices(next, subdivision) });
  };

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
      borderRadius:RAD.lg, padding:"20px",
      display:"flex", flexDirection:"column", gap:SP.lg,
      flex:1, minWidth:270, transition:"border-color 0.25s",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>
        <button onClick={onToggle} title={running ? "Detener" : "Reproducir"} style={{
          background: running ? "#2a1010" : "#0d2616",
          border:`1px solid ${running ? "#ff4a4a" : "#4aff7a"}`,
          borderRadius:RAD.md, width:38, height:32, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          color: running ? "#ff4a4a" : "#4aff7a",
          boxShadow: running ? "none" : "0 0 10px #4aff7a33",
          transition:"all 0.15s",
        }}>
          {running ? <Square size={13} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
      </div>

      <div style={{ borderTop:`1px solid ${accent}1a` }}>
        <button onClick={() => setSettingsOpen((o) => !o)} style={{
          width:"100%", background:"none", border:"none", cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0 2px",
        }}>
          <span style={etiqueta()}>BPM Y RELACIÓN</span>
          <ChevronRight size={12} color={TX.muted} style={{ transform: settingsOpen ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
        </button>
      </div>
      <div style={{ display: settingsOpen ? "flex" : "none", flexDirection:"column", gap:SP.lg }}>
      <div style={{ display:"flex", alignItems:"center", gap:SP.lg }}>
        <div style={{
          fontFamily:"'JetBrains Mono',monospace", fontSize:FS.hero, fontWeight:700, lineHeight:1, minWidth:96, textAlign:"center",
          color: bpmFlash ? "#ffd04a" : accent,
          textShadow: bpmFlash ? "0 0 18px #ffd04a" : "none",
          transition: bpmFlash ? "none" : "color 0.45s, text-shadow 0.45s",
        }}>
          {Math.round(bpm)}
        </div>
        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:SP.sm }}>
          <input type="range" min={1} max={600} value={Math.round(bpm)}
            onChange={(e) => { const v = parseInt(e.target.value); onChange({ bpm: v, baseBpm: v }); }}
            style={{ width:"100%", accentColor:accent, cursor:"pointer" }} />
          <button onClick={handleTap} style={{ background:`${accent}14`, border:`1px solid ${accent}44`, borderRadius:RAD.md, color:accent, fontFamily:"'JetBrains Mono',monospace", fontSize:FS.small, fontWeight:600, padding:"8px", cursor:"pointer", letterSpacing:1 }}>TAP TEMPO</button>
          <div style={{ display:"flex", gap:SP.sm }}>
            {[-10,-1,+1,+10].map((d) => (
              <button key={d} onClick={() => { const v = Math.min(600, Math.max(1, Math.round(bpm)+d)); onChange({ bpm: v, baseBpm: v }); }} style={{ background:"#252830", border:`1px solid ${accent}33`, borderRadius:RAD.sm, color:accent, fontFamily:"monospace", fontSize:FS.small, padding:"5px 10px", cursor:"pointer" }}>{d > 0 ? `+${d}` : d}</button>
            ))}
          </div>
        </div>
        <div style={{ background:"#15171c", border:`1px solid ${accent}2a`, borderRadius:RAD.sm, padding:"6px 10px", textAlign:"center", minWidth:58 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:FS.lead, fontWeight:700, color: running ? accent : "#333", lineHeight:1, transition:"color 0.3s" }}>{String(measures).padStart(3,"0")}</div>
          <div style={{ color:TX.muted, fontSize:FS.micro, marginTop:3, fontFamily:"monospace", letterSpacing:1 }}>BAR</div>
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:SP.md, flexWrap:"wrap" }}>
        <NumberSelect label="SUBDIV" value={subdivision} values={FIGURE_VALUES}
          onChange={(v) => onChange({ subdivision: v })} accent={accent} />
        {subdivision > 1 && (
          <span style={etiqueta()}>
            CLIC EN UN PUNTO = ACENTO
          </span>
        )}
      </div>

      {accentView && (
        <div>
          <div style={{ ...etiqueta(), marginBottom:SP.sm }}>
            ACENTOS DEL COMPÁS
            <span style={{ color:"#ffd04a", marginLeft:6 }}>PASO {accentView.step}</span>
          </div>
          <AccentDots total={accentView.total} groups={accentView.groups}
            onChange={(g) => onChange({ accentGroups: g })} accent={accent} />
        </div>
      )}

      {/* La misma fila hace dos cosas: muestra qué subdivisión está sonando y
          deja marcar dónde abre cada grupo. Sin agrupar, una subdivisión alta
          es una nube de clicks — un 21 se estudia como 3+3+3+3+3+3+3, o como
          2+2+3 repetido. */}
      <div style={{ display:"flex", gap:SP.sm, justifyContent:"center", flexWrap:"wrap" }}>
        {Array.from({ length:subdivision }, (_,i) => {
          const isNow = subTick === i;
          const isAcc = subAccentIdx.has(i);
          return (
            <button key={i} onClick={() => toggleSubAccent(i)} disabled={i === 0}
              title={i === 0 ? "El pulso siempre abre grupo" : "Marcar inicio de grupo"}
              style={{
                width:15, height:15, borderRadius:"50%", padding:0,
                cursor: i === 0 ? "default" : "pointer",
                background: isNow ? (isAcc ? accent : `${accent}77`) : (isAcc ? dimAccent : "#222530"),
                boxShadow: isNow ? `0 0 8px ${accent}` : "none",
                border:`1px solid ${isAcc ? accent : accent + "1a"}`,
                transition:"background 0.04s, box-shadow 0.04s",
              }} />
          );
        })}
      </div>
      </div>

      <div style={{ borderTop:`1px solid ${accent}1a` }}>
        <button onClick={() => setSoundOpen((o) => !o)} style={{
          width:"100%", background:"none", border:"none", cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0 2px",
        }}>
          <span style={etiqueta()}>SONIDO Y VOLUMEN</span>
          <ChevronRight size={12} color={TX.muted} style={{ transform: soundOpen ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
        </button>
        <div style={{ display: soundOpen ? "flex" : "none", flexDirection:"column", gap:SP.sm, paddingTop:8 }}>
          <div style={{ display:"flex", gap:SP.md, flexWrap:"wrap" }}>
            <SoundSelect label="FUERTE" value={strongSound} onChange={(v) => onChange({ strongSound:v })} accent={accent} />
            <SoundSelect label="DÉBIL"  value={weakSound}   onChange={(v) => onChange({ weakSound:v })}   accent={accent} />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:SP.sm }}>
            <button onClick={() => onChange({ muted:!muted })} style={{ background:"none", border:"none", cursor:"pointer", color: muted ? "#333" : accent, padding:2 }}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => onChange({ volume: parseFloat(e.target.value) })} style={{ flex:1, accentColor:accent }} disabled={muted} />
            <span style={{ color:TX.muted, fontSize:FS.micro, fontFamily:"monospace", width:26, textAlign:"right" }}>{Math.round(volume*100)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── dual switch ──────────────────────────────────────────────────────────────
// Barra de transporte fija, no un botón suelto flotando.
//
// El botón redondo suelto tapaba lo que quedara debajo al desplazar la página:
// el panel de BPM, la fila de acentos, lo que tocara. Una barra con fondo y
// borde define un borde real, y el contenido reserva su alto para que nunca
// quede nada escondido detrás.
function DualSwitch({ on, onToggle }) {
  return (
    <div style={{
      position:"fixed", bottom:0, left:0, right:0, zIndex:1001,
      height:TRANSPORTE, display:"flex", alignItems:"center", justifyContent:"center",
      background:BG.page, borderTop:`1px solid ${BG.line}`,
      boxShadow:`0 -12px 24px ${BG.page}`,
    }}>
      <button onClick={onToggle} title={on ? "Detener" : "Iniciar"} style={{
        display:"flex", alignItems:"center", justifyContent:"center",
        width:64, height:64, borderRadius:"50%",
        background: on ? "#2a1010" : "#0d2616",
        border:`2px solid ${on ? VOZ.parar : "#4aff7a"}`,
        cursor:"pointer", userSelect:"none",
        boxShadow: on ? `0 0 20px ${VOZ.parar}44` : "0 0 24px #4aff7a55",
        transition:`all ${DUR.base}ms ${EASE.entra}`,
      }}>
        {on
          ? <Square size={26} color={VOZ.parar} fill={VOZ.parar} />
          : <Play  size={28} color="#4aff7a" fill="#4aff7a" style={{ marginLeft:3 }} />
        }
      </button>
    </div>
  );
}

// ─── progressive practice ─────────────────────────────────────────────────────
function ProgressivePractice({ onBpmChange, onActivate, onStatus }) {
  const [on, setOn]     = useState(false);
  const [cfg, setCfg]   = useState({ bpmStart:30, bpmMax:140, increment:5, intervalSec:120, onMax:"stop" });
  const [curBpm, setCurBpm]     = useState(30);
  const [timeLeft, setTimeLeft] = useState(120);
  const curBpmRef = useRef(30);
  const leftRef   = useRef(120); // cuenta regresiva del paso, fuera del render
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
    leftRef.current   = cfg.intervalSec;
    setCurBpm(cfg.bpmStart); setTimeLeft(cfg.intervalSec);
    onBpmRef.current(cfg.bpmStart); onActivate(); setOn(true);
  };
  const stop = () => { setOn(false); clearInterval(timerRef.current); };

  // La cuenta vive en un ref y los efectos ocurren en el callback del interval,
  // no dentro de un updater de setState. Un updater tiene que ser puro: React
  // lo puede invocar más de una vez, y StrictMode lo hace a propósito para
  // exponer justamente esto. Con el incremento adentro del updater, cada paso
  // subía el tempo dos veces — invisible con pasos de 120 s, evidente con 1 s.
  useEffect(() => {
    if (!on) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      const c = cfgRef.current;
      if (leftRef.current > 1) {
        leftRef.current -= 1;
        setTimeLeft(leftRef.current);
        return;
      }
      const next = Math.min(curBpmRef.current + c.increment, c.bpmMax);
      curBpmRef.current = next; setCurBpm(next); onBpmRef.current(next);
      leftRef.current = c.intervalSec;
      setTimeLeft(c.intervalSec);
      if (next >= c.bpmMax) {
        if (c.onMax === "stop")    stop();
        if (c.onMax === "restart") { curBpmRef.current = c.bpmStart; setCurBpm(c.bpmStart); onBpmRef.current(c.bpmStart); }
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [on]);

  return (
    <div style={{ background:"#1e2028", borderRadius:RAD.lg, padding:20, border:`1px solid ${on ? "#ffd04a44" : "#252830"}`, transition:"border-color 0.3s" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div style={etiqueta()}>PRÁCTICA PROGRESIVA</div>
        <button onClick={on ? stop : start} style={{ background: on ? "#3d2a0d" : "#252830", border:`1px solid ${on ? "#ffd04a" : "#3a3d47"}`, borderRadius:RAD.sm, color: on ? "#ffd04a" : "#666", fontFamily:"monospace", fontSize:FS.small, fontWeight:600, padding:"5px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:SP.sm }}>
          {on ? <Square size={11} /> : <Play size={11} />}{on ? "DETENER" : "INICIAR"}
        </button>
      </div>
      <div style={{ display:"flex", gap:SP.md, flexWrap:"wrap", marginBottom: on ? 14 : 0 }}>
        {[["BPM INICIO","bpmStart",1,580],["BPM MÁX","bpmMax",2,600],["+ BPM","increment",1,20],["SEG / PASO","intervalSec",1,600]].map(([lbl,k,mn,mx]) => (
          <div key={k} style={{ display:"flex", flexDirection:"column", gap:SP.xs, minWidth:80 }}>
            <div style={etiqueta()}>{lbl}</div>
            <input type="number" min={mn} max={mx} value={cfg[k]} onChange={(e) => set(k, Math.max(mn, parseInt(e.target.value)||mn))} disabled={on}
              style={{ background:"#252830", border:"1px solid #3a3d47", borderRadius:RAD.sm, color: on ? "#555" : "#ddd", fontFamily:"monospace", fontSize:FS.small, padding:"4px 8px", width:"100%", outline:"none" }} />
          </div>
        ))}
        <div style={{ display:"flex", flexDirection:"column", gap:SP.xs, minWidth:90 }}>
          <div style={etiqueta()}>AL LLEGAR AL MÁX</div>
          <select value={cfg.onMax} onChange={(e) => set("onMax",e.target.value)} disabled={on}
            style={{ background:"#252830", border:"1px solid #3a3d47", borderRadius:RAD.sm, color: on ? "#555" : "#ddd", fontFamily:"monospace", fontSize:FS.small, padding:"4px 6px", outline:"none", cursor:"pointer" }}>
            <option value="stop">Detener</option>
            <option value="hold">Mantener</option>
            <option value="restart">Reiniciar</option>
          </select>
        </div>
      </div>
      {on && (
        <div style={{ display:"flex", gap:SP.lg, alignItems:"center", background:"#15171c", borderRadius:RAD.md, padding:"12px 16px", border:"1px solid #ffd04a22" }}>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:FS.lead, color:"#ffd04a", fontWeight:700, lineHeight:1 }}>{curBpm}</div>
            <div style={{ color:TX.muted, fontSize:FS.micro, fontFamily:"monospace", marginTop:2 }}>BPM ACTUAL</div>
          </div>
          <ChevronRight size={14} color="#333" />
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:FS.lead, color:TX.faint, lineHeight:1 }}>{Math.min(curBpm + cfg.increment, cfg.bpmMax)}</div>
            <div style={{ color:TX.muted, fontSize:FS.micro, fontFamily:"monospace", marginTop:2 }}>PRÓXIMO</div>
          </div>
          <div style={{ flex:1 }} />
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:FS.lead, fontWeight:700, color: timeLeft <= 10 ? "#ff6b4a" : "#ffd04a", lineHeight:1, transition:"color 0.3s" }}>{fmt(timeLeft)}</div>
            <div style={{ color:TX.muted, fontSize:FS.micro, fontFamily:"monospace", marginTop:2 }}>PRÓXIMO INCREMENTO</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── phase-sync info (DUAL LIBRE) ─────────────────────────────────────────────
// Two independent integer BPMs starting together realign exactly every
// 60/gcd(bpmA,bpmB) seconds. Shows that estimate and an opt-in auto-stop.
// Plegable como los demás paneles, y abajo con ellos. Antes ocupaba una franja
// entera justo entre el visualizador y los controles, que es el peor sitio:
// empujaba todo hacia abajo para mostrar un solo número.
function PhaseSyncInfo({ bpmA, bpmB, pulseCountA, running }) {
  const [open, setOpen] = useState(false);
  const { targetA, seconds } = libreCycleTargets(bpmA, bpmB);
  const fmt = (s) => s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s/60)}m ${Math.round(s%60)}s`;
  const same = Math.round(bpmA) === Math.round(bpmB);
  // la cuenta baja un paso por pulso real de A, nunca por un reloj de pared, así
  // que siempre coincide con lo que está sonando
  const remaining = cycleRemaining(pulseCountA, targetA);
  const valor = same ? "—" : running ? `${remaining} pulsos` : fmt(seconds);

  return (
    <div style={{ background:"#1e2028", borderRadius:RAD.lg, border:"1px solid #252830" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width:"100%", background:"none", border:"none", cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px", gap:SP.md,
      }}>
        <span style={etiqueta()}>COINCIDENCIA</span>
        <span style={{ display:"flex", alignItems:"center", gap:SP.md }}>
          {/* plegado ya muestra el número: abrirlo es opcional */}
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:FS.body, fontWeight:700, color: same ? "#444" : "#ffd04a" }}>
            {valor}
          </span>
          <ChevronRight size={14} color={TX.muted} style={{ transform: open ? "rotate(90deg)" : "none", transition:`transform ${DUR.fast}ms ${EASE.entra}` }} />
        </span>
      </button>
      <div style={{ display: open ? "block" : "none", padding:"0 20px 16px", color:TX.faint, fontFamily:"monospace", fontSize:FS.small, lineHeight:1.6 }}>
        {same
          ? "Los dos metrónomos van al mismo BPM, así que nunca se separan."
          : <>Con {Math.round(bpmA)} contra {Math.round(bpmB)} BPM, las dos voces vuelven a caer juntas cada <span style={{ color:"#ffd04a", fontWeight:700 }}>{fmt(seconds)}</span> — {targetA} pulsos de A.</>}
      </div>
    </div>
  );
}

// ─── secuencia de compases (pestaña de PRÁCTICA) ──────────────────────────────
// Una fila por paso y nada más: "2 × 4/4", los puntos de acento y la ✕. El punto
// chico de la izquierda apaga la fila: eso son los compases mudos (gap click),
// sin ser una función aparte.
const SEQ_ACC = "#ffd04a";
const MEASURE_VALUES = range(1, 16);

function SeqNum({ value, values, onChange, stop }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}
      onClick={stop ? (e) => e.stopPropagation() : undefined} style={{
      background:"#252830", border:"1px solid #3a3d47", borderRadius:RAD.sm, color:"#ddd",
      fontFamily:"'JetBrains Mono',monospace", fontSize:FS.small, padding:"3px 2px",
      outline:"none", cursor:"pointer", width:40, textAlign:"center",
    }}>
      {values.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
}

// Un punto por compás del paso, no por pulso: es la cuenta de "3 compases de
// 3/4" avanzando. El compás que está sonando queda lleno, los que ya pasaron
// en esta vuelta quedan tenues, y los que faltan, vacíos.
function MeasureDots({ total, current }) {
  return (
    <div style={{ display:"flex", gap:SP.sm, flexWrap:"wrap", justifyContent:"flex-end" }}>
      {Array.from({ length: total }, (_, i) => {
        const ahora = current === i, pasado = current != null && i < current;
        return (
          <span key={i} style={{
            width:9, height:9, borderRadius:"50%",
            background: ahora ? SEQ_ACC : pasado ? SEQ_ACC + "55" : "transparent",
            border:`1px solid ${ahora ? SEQ_ACC : SEQ_ACC + "44"}`,
            transition:"background 0.08s",
          }} />
        );
      })}
    </div>
  );
}

// Una columna: la lista de compases de UNA voz, con su color y su botón.
function SequenceColumn({ steps, onSteps, on, onToggle, pos, sel, onSel, accent, label }) {
  const set = (i, patch) => onSteps(steps.map((s, j) => (j === i ? normalizeStep({ ...s, ...patch }) : s)));
  const del = (i) => { if (steps.length > 1) onSteps(steps.filter((_, j) => j !== i)); };
  const add = () => onSteps([...steps, normalizeStep({ measures:1, num:4, den:4 })]);
  return (
    <div style={{
      flex:1, minWidth:250, display:"flex", flexDirection:"column", gap:SP.sm,
      border:`1px solid ${on ? accent : accent + "33"}`, borderRadius:RAD.lg, padding:10,
      transition:"border-color 0.25s",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:SP.sm }}>
        <span style={{ color:accent, fontFamily:"'JetBrains Mono',monospace", fontSize:FS.small, fontWeight:700 }}>
          {label} <span style={{ color:TX.faint, fontWeight:400 }}>{sequenceLabel(steps)}</span>
        </span>
      </div>
      {steps.map((s, i) => {
        const live = on && pos?.stepIdx === i;
        const elegido = sel === i;
        return (
          <div key={i}
            onClick={() => onSel(elegido ? null : i)}
            title={elegido ? "Editando los acentos de este paso — clic para soltar" : "Clic para editar los acentos de este paso"}
            style={{
            borderRadius:RAD.md, cursor:"pointer",
            background: elegido ? accent + "22" : live ? accent + "14" : "transparent",
            border:`1px solid ${elegido ? accent : live ? accent + "66" : "transparent"}`,
            opacity: s.muted ? 0.45 : 1, transition:"background 0.15s, border-color 0.15s",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:SP.sm, padding:"5px 8px" }}>
              <button onClick={(e) => { e.stopPropagation(); set(i, { muted: !s.muted }); }} style={{
                width:9, height:9, borderRadius:"50%", padding:0, cursor:"pointer", flexShrink:0,
                background: s.muted ? "transparent" : accent,
                border:`1px solid ${s.muted ? "#555" : accent}`,
              }} />
              <SeqNum stop value={s.measures} values={MEASURE_VALUES} onChange={(v) => set(i, { measures:v })} />
              <span style={{ color:TX.muted, fontSize:FS.small }}>×</span>
              <SeqNum stop value={s.num} values={range(1, MAX_NUM)} onChange={(v) => set(i, { num:v, groups:null })} />
              <span style={{ color:TX.muted, fontSize:FS.small }}>/</span>
              <SeqNum stop value={s.den} values={DEN_VALUES} onChange={(v) => set(i, { den:v })} />
              <div style={{ flex:1, display:"flex", justifyContent:"flex-end", padding:"4px 0" }}>
                <MeasureDots total={s.measures} current={live ? pos?.measureInStep : null} />
              </div>
              <button onClick={(e) => { e.stopPropagation(); del(i); }} style={{
                background:"none", border:"none", color:TX.muted, cursor:"pointer",
                fontSize:FS.small, padding:"0 2px", flexShrink:0,
              }}>✕</button>
            </div>
          </div>
        );
      })}
      <div style={{ display:"flex", alignItems:"center", gap:SP.md, paddingLeft:8 }}>
        <button onClick={add} style={{
          background:"none", border:"1px dashed #3a3d47", borderRadius:14, color:TX.faint,
          fontFamily:"monospace", fontSize:FS.small, lineHeight:1, padding:"4px 12px", cursor:"pointer",
        }}>+</button>
        <div style={{ flex:1 }} />
        <button onClick={onToggle} style={{
          background: on ? accent : "transparent", border:`1px solid ${accent}`, borderRadius:RAD.sm,
          color: on ? "#15171c" : accent, fontFamily:"monospace", fontSize:FS.micro, fontWeight:600,
          letterSpacing:1, padding:"7px 16px", cursor:"pointer",
        }}>{on ? "PARAR" : "INICIAR"}</button>
      </div>

    </div>
  );
}

// Las dos columnas, A y B, más la fila de presets que comparten.
// La secuencia doble sólo se ofrece en DUAL TEMPO: es el único modo con BPM
// independientes por voz. En SINC y POLY el BPM de B lo fija la relación del
// modo, así que una segunda secuencia no sería independiente de verdad.
function SequencePractice({
  stepsA, onStepsA, onA, onToggleA, posA, selA, onSelA,
  stepsB, onStepsB, onB, onToggleB, posB, selB, onSelB,
  dobleDisponible, presets, onSavePreset, onDeletePreset,
}) {
  const [nombre, setNombre] = useState("");
  const [destino, setDestino] = useState("A");
  const stepsDe = (v) => (v === "B" ? stepsB : stepsA);
  const cargarEn = (v, st) => (v === "B" ? onStepsB(st) : onStepsA(st));
  const guardar = () => { if (nombre.trim()) { onSavePreset(nombre, stepsDe(destino)); setNombre(""); } };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:SP.md }}>
      <div style={{ display:"flex", gap:SP.md, flexWrap:"wrap" }}>
        <SequenceColumn steps={stepsA} onSteps={onStepsA} on={onA} onToggle={onToggleA}
          pos={posA} sel={selA} onSel={onSelA} accent="#ff6b4a" label="A" />
        {dobleDisponible && (
          <SequenceColumn steps={stepsB} onSteps={onStepsB} on={onB} onToggle={onToggleB}
            pos={posB} sel={selB} onSel={onSelB} accent="#4ad9ff" label="B" />
        )}
      </div>

      {!dobleDisponible && (
        <div style={{ color:TX.muted, fontSize:FS.micro, fontFamily:"monospace", lineHeight:1.5 }}>
          La secuencia de B vive en DUAL TEMPO, el único modo con BPM independientes por voz.
        </div>
      )}

      {/* presets: guardar una secuencia con nombre y cargarla en la voz que elijas */}
      <div style={{ borderTop:"1px solid #252830", paddingTop:10, display:"flex", flexDirection:"column", gap:SP.sm }}>
        <div style={{ display:"flex", gap:SP.sm, alignItems:"center", flexWrap:"wrap" }}>
          {dobleDisponible && (
            <div style={{ display:"flex", gap:SP.xs }}>
              {["A","B"].map((v) => {
                const on = destino === v;
                const c = v === "A" ? "#ff6b4a" : "#4ad9ff";
                return (
                  <button key={v} onClick={() => setDestino(v)} title={`Guardar y cargar en ${v}`} style={{
                    background: on ? c : "transparent", border:`1px solid ${on ? c : "#3a3d47"}`,
                    borderRadius:RAD.sm, color: on ? "#15171c" : "#666",
                    fontFamily:"'JetBrains Mono',monospace", fontSize:FS.small, fontWeight:700,
                    padding:"5px 10px", cursor:"pointer",
                  }}>{v}</button>
                );
              })}
            </div>
          )}
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40}
            onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
            placeholder="Nombre del preset"
            style={{
              flex:1, minWidth:120, background:"#252830", border:"1px solid #3a3d47", borderRadius:RAD.sm,
              color:"#ddd", fontFamily:"monospace", fontSize:FS.small, padding:"5px 8px", outline:"none",
            }} />
          <button onClick={guardar} disabled={!nombre.trim()} style={{
            background:"none", border:`1px solid ${nombre.trim() ? SEQ_ACC : "#3a3d47"}`, borderRadius:RAD.sm,
            color: nombre.trim() ? SEQ_ACC : "#444", fontFamily:"monospace", fontSize:FS.micro, fontWeight:600,
            padding:"6px 12px", cursor: nombre.trim() ? "pointer" : "default", letterSpacing:1, flexShrink:0,
          }}>GUARDAR</button>
        </div>
        {presets?.length > 0 && (
          <div style={{ display:"flex", gap:SP.sm, flexWrap:"wrap" }}>
            {presets.map((p) => (
              <span key={p.name} style={{
                display:"inline-flex", alignItems:"center", gap:SP.sm,
                background:"#252830", border:"1px solid #3a3d47", borderRadius:RAD.lg, padding:"3px 4px 3px 10px",
              }}>
                <button onClick={() => cargarEn(destino, p.steps)}
                  title={`${sequenceLabel(p.steps)} — cargar en ${dobleDisponible ? destino : "A"}`} style={{
                  background:"none", border:"none", color:"#bbb", cursor:"pointer",
                  fontFamily:"monospace", fontSize:FS.micro, padding:0,
                }}>{p.name}</button>
                <button onClick={() => onDeletePreset(p.name)} title="Borrar preset" style={{
                  background:"none", border:"none", color:TX.muted, cursor:"pointer",
                  fontSize:FS.micro, lineHeight:1, padding:"0 3px",
                }}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── practice panel (collapsible, tabs: TIMER | PROGRESIVA | SECUENCIA) ───────
// Both children stay mounted (hidden with display:none) so a running timer or
// progressive session keeps counting while collapsed or on the other tab.
function PracticePanel({ onBpmChange, onActivate, running, status, onStatus,
                         seq, presets, onSavePreset, onDeletePreset }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState("prog");
  const active = status?.progOn || seq.onA || seq.onB;
  return (
    <div style={{ background:"#1e2028", borderRadius:RAD.lg, border:`1px solid ${active ? "#ffd04a44" : "#252830"}`, transition:"border-color 0.3s" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width:"100%", background:"none", border:"none", cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px", gap:SP.md,
      }}>
        <span style={etiqueta()}>PRÁCTICA</span>
        <span style={{ display:"flex", alignItems:"center", gap:SP.md }}>
          {status?.progOn && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:FS.body, fontWeight:700, color:"#ffd04a" }}>
              ▲ {fmtMMSS(status.progLeft)}
            </span>
          )}
          {seq.onA && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:FS.small, color:"#ff6b4a" }}>
              {sequenceLabel(seq.stepsA)}
            </span>
          )}
          {seq.onB && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:FS.small, color:"#4ad9ff" }}>
              {sequenceLabel(seq.stepsB)}
            </span>
          )}
          <ChevronRight size={14} color={TX.muted} style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
        </span>
      </button>
      <div style={{ display: open ? "flex" : "none", flexDirection:"column", gap:SP.md, padding:"0 16px 16px" }}>
        <div style={{ display:"flex", background:"#15171c", borderRadius:RAD.md, padding:3, gap:SP.xs }}>
          {[["prog","PROGRESIVA"],["seq","SECUENCIA"]].map(([k, lbl]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={{
                flex:1, background: on ? "#ffd04a1a" : "none",
                border:`1px solid ${on ? "#ffd04a" : "transparent"}`,
                borderRadius:RAD.sm, color: on ? "#ffd04a" : "#444",
                fontFamily:"monospace", fontSize:FS.micro, fontWeight: on ? 600 : 400,
                padding:"7px 10px", cursor:"pointer", letterSpacing:0.5,
              }}>{lbl}</button>
            );
          })}
        </div>
        <div style={{ display: tab === "prog" ? "block" : "none" }}>
          <ProgressivePractice onBpmChange={onBpmChange} onActivate={onActivate} running={running} onStatus={onStatus} />
        </div>
        <div style={{ display: tab === "seq" ? "block" : "none" }}>
          <SequencePractice {...seq}
            presets={presets} onSavePreset={onSavePreset} onDeletePreset={onDeletePreset} />
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
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:SP.sm,
  });
  const numStyle = (on, color, visible) => ({
    fontFamily:"'JetBrains Mono',monospace", fontWeight:800, lineHeight:1,
    fontSize:"min(20vw, 200px)",
    color: on ? "#15171c" : color,
    opacity: visible ? (on ? 0.92 : 0.22) : 0,
    transition:"none",
  });
  const subStyle = (on, color, visible) => ({
    fontFamily:"monospace", fontSize:FS.lead, letterSpacing:3, fontWeight:600,
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

// ─── flash toggle button (top-right) ──────────────────────────────────────────
function FlashToggle({ on, onToggle }) {
  return (
    <button onClick={onToggle} title={on ? "Desactivar destello de pantalla" : "Activar destello de pantalla"} style={{
      position:"fixed", top:16, right:16, zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center",
      width:40, height:40, borderRadius:RAD.lg,
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

// ─── circle-only fullscreen toggle (top-right, next to FlashToggle) ──────────
function CircleFullscreenToggle({ on, onToggle }) {
  return (
    <button onClick={onToggle} title={on ? "Salir de pantalla completa" : "Ver animación en pantalla completa"} style={{
      position:"fixed", top:16, right:64, zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center",
      width:40, height:40, borderRadius:RAD.lg,
      background: on ? "#eeeeee1a" : "#1e2028",
      border:`1px solid ${on ? "#eee" : "#3a3d47"}`,
      color: on ? "#eee" : "#555",
      cursor:"pointer", transition:"all 0.15s",
    }}>
      <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" />
      </svg>
    </button>
  );
}

// ─── additive-meter accent editor ──────────────────────────────────────────────
// One dot per pulse in the cycle. Pulse 0 is always the downbeat (can't be
// toggled off); tapping any other dot marks/unmarks it as a group start,
// e.g. tapping pulses 3 and 6 of an 8 gives the 3+3+2 songo grouping.
function AccentDots({ total, groups, onChange, accent }) {
  const indices = accentSet(effectiveGroups(groups, total));
  const toggle = (i) => {
    if (i === 0) return;
    const next = new Set(indices);
    if (next.has(i)) next.delete(i); else next.add(i);
    onChange(groupsFromIndices(next, total));
  };
  return (
    <div style={{ display:"flex", gap:SP.sm, flexWrap:"wrap" }}>
      {Array.from({ length: total }, (_, i) => (
        <button key={i} onClick={() => toggle(i)} disabled={i === 0} style={{
          width:15, height:15, borderRadius:"50%", padding:0, cursor: i === 0 ? "default" : "pointer",
          background: indices.has(i) ? accent : "#252830",
          border:`1px solid ${indices.has(i) ? accent : accent + "33"}`,
        }} />
      ))}
    </div>
  );
}

// ─── sync volume + sound editor (DUAL SINC) ───────────────────────────────────
function SyncControls({ metA, metB, onChangeA, onChangeB }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ maxWidth:ANCHO, margin:"0 auto 18px", background:"#1e2028", borderRadius:RAD.lg, border:"1px solid #252830" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width:"100%", background:"none", border:"none", cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px",
      }}>
        <span style={etiqueta()}>SONIDO Y VOLUMEN</span>
        <ChevronRight size={14} color={TX.muted} style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
      </button>
      <div style={{ display: open ? "flex" : "none", flexDirection:"column", gap:SP.lg, padding:"0 20px 16px" }}>

      {/* volume row */}
      <div style={{ display:"flex", gap:SP.lg, flexWrap:"wrap" }}>
        {[
          { label:"A", accent:"#ff6b4a", met:metA, onChange:onChangeA },
          { label:"B", accent:"#4ad9ff", met:metB, onChange:onChangeB },
        ].map(({ label, accent, met, onChange }) => (
          <div key={label} style={{ flex:1, minWidth:200 }}>
            <div style={{ display:"flex", alignItems:"center", gap:SP.sm }}>
              <button onClick={() => onChange({ muted: !met.muted })} style={{ background:"none", border:"none", cursor:"pointer", color: met.muted ? "#333" : accent, padding:2 }}>
                {met.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              <input type="range" min={0} max={1} step={0.01} value={met.volume}
                onChange={(e) => onChange({ volume: parseFloat(e.target.value) })}
                style={{ flex:1, accentColor:accent }} disabled={met.muted} />
              <span style={{ color:TX.muted, fontSize:FS.micro, fontFamily:"monospace", width:26, textAlign:"right" }}>{Math.round(met.volume * 100)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* sound pickers row */}
      <div style={{ display:"flex", gap:SP.lg, flexWrap:"wrap" }}>
        {[
          { label:"A", accent:"#ff6b4a", met:metA, onChange:onChangeA },
          { label:"B", accent:"#4ad9ff", met:metB, onChange:onChangeB },
        ].map(({ label, accent, met, onChange }) => (
          <div key={label} style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column", gap:SP.sm }}>
            <SoundSelect label="FUERTE" value={met.strongSound}
              onChange={(v) => onChange({ strongSound: v })} accent={accent} />
            <SoundSelect label="DÉBIL" value={met.weakSound}
              onChange={(v) => onChange({ weakSound: v })} accent={accent} />
          </div>
        ))}
      </div>

      {/* Los acentos ya no viven aquí: se mudaron al panel de BPM Y RELACIÓN,
          junto al compás. El acento no es una decisión de timbre — en métrica
          aditiva el acento ES la métrica. */}
      </div>
    </div>
  );
}

// ─── polimetría panel ─────────────────────────────────────────────────────────
function PolyMetriaPanel({ bpm, beatsA, beatsB, onBpm, onBeatsA, onBeatsB, onTap, pulseCount, running, metA, metB, onChangeA, onChangeB, bpmFlash, accentViewA, accentViewB }) {
  const lcmAB = lcm(beatsA, beatsB);
  const remaining = cycleRemaining(pulseCount, lcmAB);
  const [open, setOpen] = useState(true);
  return (
    <div style={{ background:"#1e2028", borderRadius:RAD.lg, maxWidth:ANCHO, margin:"0 auto", border:"1px solid #252830" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width:"100%", background:"none", border:"none", cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px",
      }}>
        <span style={etiqueta()}>BPM Y RELACIÓN</span>
        <ChevronRight size={14} color={TX.muted} style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
      </button>
      <div style={{ display: open ? "flex" : "none", flexDirection:"column", gap:SP.lg, padding:"0 24px 20px" }}>
      {/* BPM compartido */}
      <div>
        <div style={{ ...etiqueta(), marginBottom:SP.sm }}>BPM</div>
        <div style={{ display:"flex", alignItems:"center", gap:SP.lg }}>
          <div style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:FS.hero, fontWeight:700, lineHeight:1, minWidth:96,
            color: bpmFlash ? "#ffd04a" : "#4aff9a",
            textShadow: bpmFlash ? "0 0 18px #ffd04a" : "none",
            transition: bpmFlash ? "none" : "color 0.45s, text-shadow 0.45s",
          }}>{bpm}</div>
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:SP.sm }}>
            <input type="range" min={1} max={600} value={bpm} onChange={(e) => onBpm(parseInt(e.target.value))} style={{ width:"100%", accentColor:"#4aff9a" }} />
            <div style={{ display:"flex", gap:SP.sm }}>
              {[-10,-1,+1,+10].map((d) => (
                <button key={d} onClick={() => onBpm(Math.min(600, Math.max(1, bpm + d)))} style={{ background:"#252830", border:"1px solid #4aff9a33", borderRadius:RAD.sm, color:"#4aff9a", fontFamily:"monospace", fontSize:FS.small, padding:"4px 9px", cursor:"pointer" }}>{d > 0 ? `+${d}` : d}</button>
              ))}
            </div>
            <button onClick={onTap} style={{ background:"#4aff9a14", border:"1px solid #4aff9a44", borderRadius:RAD.md, color:"#4aff9a", fontFamily:"'JetBrains Mono',monospace", fontSize:FS.small, fontWeight:600, padding:"8px", cursor:"pointer", letterSpacing:1, marginTop:4 }}>TAP TEMPO</button>
          </div>
        </div>
      </div>

      {/* selectores de tiempos y acentos — el acento define la métrica, así que
          vive junto al número de pulsos, no junto al volumen */}
      <div style={{ display:"flex", gap:SP.xl, flexWrap:"wrap" }}>
        {[
          { label:"A", color:"#ff6b4a", val:beatsA, set:onBeatsA, met:metA, onChange:onChangeA },
          { label:"B", color:"#4ad9ff", val:beatsB, set:onBeatsB, met:metB, onChange:onChangeB },
        ].map(({ label, color, val, set, met, onChange }) => (
          <div key={label} style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column", gap:SP.md }}>
            <NumberSelect label={label} value={val} values={PULSE_VALUES} onChange={set} accent={color} />
            <div>
              <div style={{ ...etiqueta(), marginBottom:SP.sm }}>
                ACENTOS{(label === "A" ? accentViewA : accentViewB) && (
                  <span style={{ color:"#ffd04a", marginLeft:6 }}>PASO {(label === "A" ? accentViewA : accentViewB).step}</span>
                )}
              </div>
              <AccentDots
                total={(label === "A" ? accentViewA : accentViewB)?.total ?? beatsPerMeasure(met.timeSig)}
                groups={(label === "A" ? accentViewA : accentViewB)?.groups ?? met.accentGroups}
                onChange={(g) => onChange({ accentGroups: g })} accent={color} />
            </div>
          </div>
        ))}
      </div>

      {/* info MCM */}
      <div style={{ background:"#15171c", borderRadius:RAD.md, padding:"14px 18px", border:"1px solid #252830", display:"flex", gap:SP.xxl, flexWrap:"wrap" }}>
        <div>
          <div style={etiqueta()}>RELACIÓN</div>
          <div style={{ color:"#eee", fontFamily:"'JetBrains Mono',monospace", fontSize:FS.lead, fontWeight:700, marginTop:3 }}>{beatsA}:{beatsB}</div>
        </div>
        <div>
          <div style={etiqueta()}>MCM</div>
          <div style={{ color:"#4aff9a", fontFamily:"'JetBrains Mono',monospace", fontSize:FS.lead, fontWeight:700, marginTop:3 }}>{lcmAB}</div>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ ...etiqueta(), marginBottom:SP.sm }}>COINCIDENCIA</div>
          <div style={{ color:TX.faint, fontFamily:"monospace", fontSize:FS.small }}>
            {running
              ? <><span style={{ color:"#4aff9a", fontWeight:700, fontSize:FS.body }}>{remaining}</span> pulsos</>
              : <>cada <span style={{ color:"#4aff9a", fontWeight:700 }}>{lcmAB}</span> pulsos</>}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const DEFAULT_A = { bpm:120, baseBpm:120, timeSig:"4/4", volume:0.7, muted:false, beat:-1, lastBeat:-1, subTick:-1, strongSound:"click", weakSound:"beep",  subdivision:1, accentGroups:null, subAccents:null };
const DEFAULT_B = { bpm:90,  baseBpm:90,  timeSig:"4/4", volume:0.7, muted:false, beat:-1, lastBeat:-1, subTick:-1, strongSound:"click", weakSound:"wood",  subdivision:1, accentGroups:null, subAccents:null };

// remember the last configuration between sessions — only stable settings
// (bpm, sounds, mode params), never live playback state (beat/subTick/running)
const savedSettings = loadSettings();

// ─── main ─────────────────────────────────────────────────────────────────────
export default function DualMetronome() {
  // mode — polimetría is the primary / default mode
  const [mode, setMode] = useState(savedSettings.mode ?? "metrica");
  const modeRef = useRef(savedSettings.mode ?? "metrica");

  // polimetría params + refs (refs updated synchronously so restartNow can read them)
  const [relBase,    setRelBase]    = useState(savedSettings.relBase ?? 4);
  const [relDeriv,   setRelDeriv]   = useState(savedSettings.relDeriv ?? 4);
  const [relBpmBase, setRelBpmBase] = useState(savedSettings.relBpmBase ?? 90);
  const relBaseRef  = useRef(savedSettings.relBase ?? 4);
  const relDerivRef = useRef(savedSettings.relDeriv ?? 4);
  const relMultRef = useRef(1);

  // polimetría (tercer modo) params
  const [polyBpm,    setPolyBpm]    = useState(savedSettings.polyBpm ?? 90);
  const [polyBeatsA, setPolyBeatsA] = useState(savedSettings.polyBeatsA ?? 4);
  const [polyBeatsB, setPolyBeatsB] = useState(savedSettings.polyBeatsB ?? 4);
  const polyBpmRef    = useRef(savedSettings.polyBpm ?? 90);
  const polyBeatsARef = useRef(savedSettings.polyBeatsA ?? 4);
  const polyBeatsBRef = useRef(savedSettings.polyBeatsB ?? 4);
  const polyMultRef = useRef(1);

  // shared audio state
  const [runningA, setRunningA] = useState(false);
  const [runningB, setRunningB] = useState(false);
  const [dualOn,   setDualOn]   = useState(false);
  // metA/metB start already aligned with the default polimetría params
  // (relBase=4, relDeriv=5, relBpmBase=90) so the visualizer's ring counts
  // and MCM match the "5:4" label from the very first render — unless a
  // saved session overrides bpm/timeSig/sounds/subdivision/volume/muted
  const [metA, setMetA] = useState(() => ({ ...DEFAULT_A, bpm:90, baseBpm:90, timeSig:"4/4", ...savedSettings.metA }));
  const [metB, setMetB] = useState(() => ({ ...DEFAULT_B, bpm:90, baseBpm:90, timeSig:"4/4", ...savedSettings.metB }));
  const [measuresA, setMeasuresA] = useState(0);
  const [measuresB, setMeasuresB] = useState(0);
  const [flashOn, setFlashOn] = useState(false);
  const [vizStyle, setVizStyle] = useState("necklace"); // "rings" | "necklace" — shared across all 3 modes
  const [circleFullscreen, setCircleFullscreen] = useState(false);
  const [audioError, setAudioError] = useState(null);

  // real, beat-synced pulse counters (never a wall-clock timer) — feed the
  // POLY/LIBRE cycle countdowns and the sync ring in CircularVisualizer
  const [pulseCountA, setPulseCountA] = useState(0);
  const [pulseCountB, setPulseCountB] = useState(0);
  // practice status reported by ProgressivePractice / SequencePractice
  // (shown in the collapsed PRÁCTICA bar and as a corner countdown in lights mode)
  const [practiceStatus, setPracticeStatus] = useState({});
  const updatePracticeStatus = useCallback((patch) => setPracticeStatus((p) => ({ ...p, ...patch })), []);
  // ── secuencia de compases ──────────────────────────────────────────────────
  // seqRef con la lista cuando está encendida, null cuando no: el scheduler
  // decide con eso y no necesita mirar más estado.
  // Una secuencia por voz, con su propia lista y su propio encendido. La doble
  // solo tiene sentido en DUAL TEMPO, el único modo con BPM independientes; en
  // SINC y POLY la interfaz ofrece nada más la de A.
  // Migración: lo guardado por la versión de una sola secuencia (`seqSteps`)
  // entra como la de A.
  const [seqStepsA, setSeqStepsA] = useState(() => normalizeSequence(savedSettings.seqStepsA ?? savedSettings.seqSteps ?? DEFAULT_SEQUENCE));
  const [seqStepsB, setSeqStepsB] = useState(() => normalizeSequence(savedSettings.seqStepsB ?? DEFAULT_SEQUENCE));
  const [seqOnA, setSeqOnA] = useState(false);
  const [seqOnB, setSeqOnB] = useState(false);
  // secuencias guardadas con nombre
  const [seqPresets, setSeqPresets] = useState(() => normalizePresets(savedSettings.seqPresets));
  const handleSavePreset   = useCallback((n, st) => setSeqPresets((l) => savePreset(l, n, st)), []);
  const handleDeletePreset = useCallback((n) => setSeqPresets((l) => deletePreset(l, n)), []);
  // Paso seleccionado a mano para editar sus acentos. Sin seleccion, el editor
  // sigue al paso que suena; el problema de eso solo es que tocar un punto justo
  // en el cambio de compas se lo aplicaba al paso que acababa de entrar.
  const [seqSelA, setSeqSelA] = useState(null);
  const [seqSelB, setSeqSelB] = useState(null);
  // los refs los leen changeMetA/changeMetB, que corren fuera del render
  const seqSelRefA = useRef(null), seqSelRefB = useRef(null);
  const [seqPosA, setSeqPosA] = useState(null); // { stepIdx, measureInStep } en vivo
  const [seqPosB, setSeqPosB] = useState(null);
  const seqPosRefA = useRef(null), seqPosRefB = useRef(null);
  const seqRefA = useRef(null), seqRefB = useRef(null);
  const seqStepsRefA = useRef(seqStepsA), seqStepsRefB = useRef(seqStepsB);
  useEffect(() => {
    seqStepsRefA.current = seqStepsA;
    if (seqRefA.current) seqRefA.current = seqStepsA; // editar en vivo, sin parar
  }, [seqStepsA]);
  useEffect(() => {
    seqStepsRefB.current = seqStepsB;
    if (seqRefB.current) seqRefB.current = seqStepsB;
  }, [seqStepsB]);
  // destello del número de BPM cuando la práctica progresiva sube el tempo
  const [bpmFlash, setBpmFlash] = useState(false);
  const bpmFlashRef = useRef(null);
  useEffect(() => () => clearTimeout(bpmFlashRef.current), []);

  // audio refs — the scheduler reads exclusively from these, never from state
  // Cada voz anota acá los pulsos que ya agendó. El visualizador los lee con
  // ctx.currentTime, el mismo reloj que suena, así que la imagen no se puede
  // despegar del audio: no hay dos relojes, hay uno.
  const pulsosA = useRef(crearBuffer()), pulsosB = useRef(crearBuffer());

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
    const ahead = ctx.currentTime + LOOKAHEAD;

    const sched = (runRef, otherRef, metRef, nextRef, tickRef, setMeasures, setMet, fixedPan, seqRef, setSeqPos, seqPosRef, pulsos) => {
      if (!runRef.current) return;
      const sid = sessionRef.current; // snapshot — callbacks discard themselves if session changed
      const { bpm, timeSig, volume, muted, strongSound, weakSound, subdivision, accentGroups, subAccents } = metRef.current;
      // center if the other metronome is muted or not running
      const otherSilent = !otherRef.current || otherRef.current.muted;
      const pan = otherSilent ? 0 : fixedPan;
      const total     = beatsPerMeasure(timeSig);
      const accentIdx = accentSet(effectiveGroups(accentGroups, total));
      // agrupación interna del pulso: deja estudiar un 21 como 3+3+3+3+3+3+3
      const subAccentIdx = accentSet(effectiveGroups(subAccents, subdivision));
      const subInt = (60 / bpm) / subdivision;
      // SECUENCIA: el compás cambia paso a paso, así que el largo del ciclo y el
      // paso de tiempo no se calculan una vez, se preguntan pulso por pulso. El
      // 1 del compás nuevo cae donde tenía que caer porque el avance lo da el
      // propio pulso (`seconds`), no un intervalo fijo de arriba.
      const seq = seqRef?.current;
      while (seq && nextRef.current < ahead) {
        const info = pulseAt(tickRef.current, seq, bpm);
        const t = nextRef.current;
        const first = info.pulseInMeasure === 0;
        if (!muted && !info.muted) {
          if (first)                       synthClick(ctx, t, strongSound, volume, pan);
          else if (info.accent === "group") synthClick(ctx, t, strongSound, volume * SUB_ACCENT_LEVEL, pan);
          else                             synthClick(ctx, t, weakSound,   volume, pan);
        }
        // el dibujo lee de acá, con el mismo reloj que suena
        anotarPulso(pulsos, { t, idx: info.pulseInMeasure, total: info.num,
          acento: first ? "fuerte" : info.accent === "group" ? "grupo" : "normal",
          paso: info.seconds, groups: info.groups });
        const delay = Math.max(0, (t - ctx.currentTime) * 1000);
        const cb = info.pulseInMeasure, sig = `${info.num}/${info.den}`, grp = info.groups;
        const pos = { stepIdx: info.stepIdx, measureInStep: info.measureInStep };
        const bar = info.measureInCycle + 1;
        setTimeout(() => {
          if (sessionRef.current !== sid) return;
          // el compás y sus acentos se escriben en el estado: así las luces, el
          // visualizador y el editor de ACENTOS siguen al paso que suena sin
          // saber nada de la secuencia, y no hace falta un segundo editor
          setMet((p) => ({ ...p, timeSig: sig, accentGroups: grp, beat: cb, lastBeat: cb }));
          if (first) { setMeasures(bar); setSeqPos(pos); seqPosRef.current = pos; }
          setTimeout(() => { if (sessionRef.current !== sid) return; setMet((p) => ({ ...p, beat: -1 })); }, 75);
        }, delay);
        nextRef.current += info.seconds;
        tickRef.current++;
      }
      if (seq) return;
      while (nextRef.current < ahead) {
        const tick    = tickRef.current;
        const subIdx  = tick % subdivision;
        const beatIdx = Math.floor(tick / subdivision) % total;
        const isMain  = subIdx === 0;
        const isAcc   = isMain && accentIdx.has(beatIdx);
        const isSubAcc = !isMain && subAccentIdx.has(subIdx);
        const t       = nextRef.current;
        // Cuatro niveles, no dos: el pulso acentuado abre compás, el pulso
        // normal marca el tiempo, y las subdivisiones quedan por debajo — con
        // las que abren grupo un escalón arriba del resto. Antes el pulso y su
        // subdivisión sonaban idénticos y no se distinguía uno de otro.
        if (!muted) {
          if (isAcc)         synthClick(ctx, t, strongSound, volume, pan);
          else if (isMain)   synthClick(ctx, t, weakSound,   volume, pan);
          else if (isSubAcc) synthClick(ctx, t, weakSound,   volume * SUB_ACCENT_LEVEL, pan);
          else               synthClick(ctx, t, weakSound,   volume * SUB_LEVEL, pan);
        }
        if (isMain) {
          anotarPulso(pulsos, { t, idx: beatIdx, total,
            acento: isAcc ? "fuerte" : "normal", paso: subInt * subdivision, groups: accentGroups });
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
    // cada voz con su propia secuencia; la que tenga seqRef en null sigue con
    // el compás del modo, como siempre
    sched(runARef, metBRef, metARef, nextARef, tickARef, setMeasuresA, setMetA, -1, seqRefA, setSeqPosA, seqPosRefA, pulsosA.current);
    sched(runBRef, metARef, metBRef, nextBRef, tickBRef, setMeasuresB, setMetB, +1, seqRefB, setSeqPosB, seqPosRefB, pulsosB.current);
  }, []);

  // centralized AudioContext creation — some browsers (old Safari, strict
  // autoplay policies, no audio hardware) throw here instead of failing
  // silently later, so surface it to the user instead of a dead click
  const createCtx = () => {
    try {
      return new AudioContext();
    } catch {
      setAudioError("No se pudo iniciar el audio en este navegador. Revisa los permisos de sonido o prueba con otro navegador.");
      return null;
    }
  };

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
    limpiarBuffer(pulsosA.current); limpiarBuffer(pulsosB.current);
    setPulseCountA(0); setPulseCountB(0); // params changed mid-flight — cycle starts over
    const ctx = createCtx(); ctxRef.current = ctx;
    if (!ctx) return;
    const t0  = ctx.currentTime + 0.05;
    if (wasA) { nextARef.current = t0; tickARef.current = 0; runARef.current = true; }
    if (wasB) { nextBRef.current = t0; tickBRef.current = 0; runBRef.current = true; }
    setRunningA(wasA); setRunningB(wasB); setDualOn(wasA && wasB);
    setMeasuresA(0); setMeasuresB(0);
    scheduleBeats(); schedRef.current = setInterval(scheduleBeats, 25);
  }, [scheduleBeats]);

  // ── rescaleGrid ────────────────────────────────────────────────────────────
  // Cambio de tempo SIN reinicio. En vez de rehacer la grilla desde cero,
  // reescala lo que todavía no salió al audio.
  //
  // El scheduler avanza nextRef DESPUÉS de agendar cada tick, así que al salir
  // del bucle nextRef apunta siempre al próximo tick no agendado. Por eso se lo
  // puede mover sin pisar nada que ya esté sonando.
  //
  // Con T = ahora + LOOKAHEAD (más allá del horizonte ya agendado), todo lo que
  // viene después se mapea con t -> T + (t - T) * r. Como T es el mismo para A
  // y para B, y el intervalo se recalcula solo desde metRef.bpm en cada pasada,
  // el resultado es un mapeo lineal del eje temporal: TODA coincidencia de la
  // polirritmia se conserva exacta. Una voz cuyo BPM no cambió da r = 1 y queda
  // intacta.
  //
  // Llamar DESPUÉS de escribir el bpm nuevo en metARef/metBRef, pasando los
  // bpm viejos.
  const rescaleGrid = useCallback((oldBpmA, oldBpmB) => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") return;
    if (!runARef.current && !runBRef.current) return;
    const T = ctx.currentTime + LOOKAHEAD;
    const newA = metARef.current.bpm, newB = metBRef.current.bpm;
    if (runARef.current && oldBpmA > 0 && newA > 0)
      nextARef.current = T + (nextARef.current - T) * (oldBpmA / newA);
    if (runBRef.current && oldBpmB > 0 && newB > 0)
      nextBRef.current = T + (nextBRef.current - T) * (oldBpmB / newB);
  }, []);

  // Aplica un cambio de tempo y nada más. Cualquier cambio de compás o de
  // subdivisión NO puede pasar por aquí: ahí el factor deja de ser común a las
  // dos voces y el reescalado dejaría de ser lineal. Eso va por restartNow().
  const applyTempo = useCallback((bpmA, bpmB) => {
    const oldA = metARef.current.bpm, oldB = metBRef.current.bpm;
    if (bpmA != null) { metARef.current = { ...metARef.current, bpm: bpmA }; setMetA((p) => ({ ...p, bpm: bpmA })); }
    if (bpmB != null) { metBRef.current = { ...metBRef.current, bpm: bpmB }; setMetB((p) => ({ ...p, bpm: bpmB })); }
    rescaleGrid(oldA, oldB);
  }, [rescaleGrid]);

  // ── engine ─────────────────────────────────────────────────────────────────
  const ensureCtx = () => {
    if (!ctxRef.current || ctxRef.current.state === "closed") ctxRef.current = createCtx();
    return ctxRef.current;
  };
  const hardStop = useCallback(() => {
    sessionRef.current++;
    runARef.current = false; runBRef.current = false;
    clearInterval(schedRef.current); schedRef.current = null;
    ctxRef.current?.close(); ctxRef.current = null;
    setRunningA(false); setRunningB(false); setDualOn(false);
    limpiarBuffer(pulsosA.current); limpiarBuffer(pulsosB.current);
    setMetA((p) => ({ ...p, beat:-1 })); setMetB((p) => ({ ...p, beat:-1 }));
    setMeasuresA(0); setMeasuresB(0);
    setPulseCountA(0); setPulseCountB(0);
  }, []);

  // Real, beat-synced pulse counters — increment exactly once per actual
  // audio pulse (subTick hits 0 on every main tick, in every mode), never on
  // a wall-clock timer. Both POLY's cycle countdown and LIBRE's phase
  // countdown are derived from these, so what's on screen always matches
  // what's actually sounding.
  useEffect(() => {
    if (!(mode === "libre" || mode === "polimetria") || !runningA) return;
    if (metA.subTick !== 0) return;
    // El setState va en un callback: llamarlo derecho en el cuerpo del efecto
    // encadena renders, y era uno de los cuatro errores viejos del lint.
    const id = setTimeout(() => setPulseCountA((n) => n + 1), 0);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metA.subTick]);
  useEffect(() => {
    if (!(mode === "libre" || mode === "polimetria") || !runningB) return;
    if (metB.subTick !== 0) return;
    const id = setTimeout(() => setPulseCountB((n) => n + 1), 0);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metB.subTick]);

  const startDual = useCallback(() => {
    // defensive: never stack a second scheduler/context on top of a live one
    clearInterval(schedRef.current); schedRef.current = null;
    ctxRef.current?.close();
    limpiarBuffer(pulsosA.current); limpiarBuffer(pulsosB.current);
    setPulseCountA(0); setPulseCountB(0); // fresh cycle
    const ctx = createCtx(); ctxRef.current = ctx;
    if (!ctx) return;
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
  // Solo cambia el tempo: continuo, sin reinicio. A y B se escalan por el mismo
  // factor, así que la relación A:B queda intacta.
  const applyPoliTempo = useCallback((bpmBase) => {
    applyTempo(
      bpmBase * relMultRef.current,
      derivedBpm(bpmBase, relBaseRef.current, relDerivRef.current, relMultRef.current),
    );
  }, [applyTempo]);

  // Cambia el compás: en ese caso sí hay que rehacer la grilla desde cero.
  const applyPoliParams = useCallback((bpmBase, base, deriv) => {
    const eff  = bpmBase * relMultRef.current; // ×0.5 / ×1 / ×2
    const bpmB = derivedBpm(bpmBase, base, deriv, relMultRef.current);
    // subdivision:1 — las FIGURAS de Dual Libre no aplican en este modo
    metARef.current = { ...metARef.current, bpm: eff,  timeSig: `${base}/4`,  subdivision:1 };
    metBRef.current = { ...metBRef.current, bpm: bpmB, timeSig: `${deriv}/4`, subdivision:1 };
    setMetA((p) => ({ ...p, bpm: eff,  timeSig: `${base}/4`,  subdivision:1 }));
    setMetB((p) => ({ ...p, bpm: bpmB, timeSig: `${deriv}/4`, subdivision:1 }));
    restartNow();
  }, [restartNow]);

  const handleRelBpmBase = useCallback((v) => {
    setRelBpmBase(v);
    applyPoliTempo(v);
  }, [applyPoliTempo]);

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
   
  }, [applyPoliParams, relBpmBase]);

  const handleRelDeriv = useCallback((v) => {
    setRelDeriv(v); relDerivRef.current = v;
    applyPoliParams(relBpmBase, relBaseRef.current, v);
   
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

  // Solo el tempo: continuo, sin reinicio. Los dos lados comparten BPM, así que
  // se escalan por el mismo factor y el ciclo de coincidencia no se altera.
  const handlePolyBpm = useCallback((v) => {
    setPolyBpm(v); polyBpmRef.current = v;
    const eff = v * polyMultRef.current;
    applyTempo(eff, eff);
  }, [applyTempo]);

  const handlePolyBeatsA = useCallback((v) => {
    setPolyBeatsA(v); polyBeatsARef.current = v;
    applyPolyParams(polyBpmRef.current, v, polyBeatsBRef.current);
  }, [applyPolyParams]);

  const handlePolyBeatsB = useCallback((v) => {
    setPolyBeatsB(v); polyBeatsBRef.current = v;
    applyPolyParams(polyBpmRef.current, polyBeatsARef.current, v);
  }, [applyPolyParams]);

  // ── dual libre param handlers ──────────────────────────────────────────────
  // Tres caminos: compás o subdivisión reinician la grilla; el BPM se aplica de
  // forma continua; sonido, volumen y acentos los toma el scheduler en la
  // próxima pasada sin tocar nada.
  const changeMetA = useCallback((patch) => {
    // Con la secuencia encendida, tocar los ACENTOS edita el paso que está
    // sonando, no una agrupación suelta del modo: el editor es uno solo y
    // siempre edita el compás que se escucha.
    if (seqRefA.current && patch.accentGroups !== undefined && (seqSelRefA.current != null || seqPosRefA.current)) {
      // la seleccion manda; si no hay, sigue al que suena
      const idx = seqSelRefA.current ?? seqPosRefA.current.stepIdx;
      setSeqStepsA((prev) => prev.map((s, j) => (j === idx ? normalizeStep({ ...s, groups: patch.accentGroups }) : s)));
      return;
    }
    const structural = Object.keys(patch).some((k) => NEEDS_RESTART.has(k));
    const oldBpm = metARef.current.bpm;
    metARef.current = { ...metARef.current, ...patch };
    setMetA((p) => ({ ...p, ...patch }));
    if (!runARef.current) return;
    if (structural) restartNow();
    else if (patch.bpm != null) rescaleGrid(oldBpm, metBRef.current.bpm);
  }, [restartNow, rescaleGrid]);

  const changeMetB = useCallback((patch) => {
    // mismo ruteo que en A: con la secuencia de B encendida, tocar los ACENTOS
    // edita el paso elegido, y si no hay ninguno elegido, el que está sonando
    if (seqRefB.current && patch.accentGroups !== undefined && (seqSelRefB.current != null || seqPosRefB.current)) {
      const idx = seqSelRefB.current ?? seqPosRefB.current.stepIdx;
      setSeqStepsB((prev) => prev.map((s, j) => (j === idx ? normalizeStep({ ...s, groups: patch.accentGroups }) : s)));
      return;
    }
    const structural = Object.keys(patch).some((k) => NEEDS_RESTART.has(k));
    const oldBpm = metBRef.current.bpm;
    metBRef.current = { ...metBRef.current, ...patch };
    setMetB((p) => ({ ...p, ...patch }));
    if (!runBRef.current) return;
    if (structural) restartNow();
    else if (patch.bpm != null) rescaleGrid(metARef.current.bpm, oldBpm);
  }, [restartNow, rescaleGrid]);

  // ── mode switch ────────────────────────────────────────────────────────────
  const handleModeChange = useCallback((newMode) => {
    hardStop();
    // El compás de A tiene un solo autor a la vez. Mientras la secuencia está
    // encendida manda ella; al cambiar de modo, manda el modo, así que la
    // secuencia se apaga en vez de quedar los dos escribiendo el mismo dato.
    seqRefA.current = null; seqRefB.current = null;
    setSeqOnA(false); setSeqOnB(false);
    setSeqPosA(null); seqPosRefA.current = null;
    setSeqPosB(null); seqPosRefB.current = null;
    setMode(newMode); modeRef.current = newMode;
    if (newMode === "metrica") {
      const bpmB = derivedBpm(relBpmBase, relBaseRef.current, relDerivRef.current);
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
   
  }, [hardStop, relBpmBase]);

  // ── progressive practice bpm handler ──────────────────────────────────────
  // Cada incremento pasa por el camino continuo, en los tres modos: nunca se
  // corta el audio ni se vuelve al pulso 1. Mueve A y B con el mismo factor,
  // así que el anillo de coincidencia también sigue exacto.
  const handlePracticeBpm = useCallback((bpm) => {
    if (modeRef.current === "metrica") {
      setRelBpmBase(bpm);
      applyPoliTempo(bpm);
    } else if (modeRef.current === "polimetria") {
      setPolyBpm(bpm); polyBpmRef.current = bpm;
      const eff = bpm * polyMultRef.current;
      applyTempo(eff, eff);
    } else {
      applyTempo(bpm, bpm);
    }
    // Sin señal, el cambio es tan suave que no se distingue de haberse apurado
    // uno mismo. El destello dice "fue el metrónomo".
    setBpmFlash(true);
    clearTimeout(bpmFlashRef.current);
    bpmFlashRef.current = setTimeout(() => setBpmFlash(false), 260);
  }, [applyPoliTempo, applyTempo]);

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

  // ── secuencia: encender / apagar ───────────────────────────────────────────
  // Siempre reinicia desde el paso 1: una secuencia que arranca a mitad de
  // compás no sirve para practicar.
  const handleSeqToggleA = useCallback(() => {
    const next = !seqRefA.current;
    seqRefA.current = next ? seqStepsRefA.current : null;
    setSeqOnA(next);
    setSeqPosA(null); seqPosRefA.current = null;
    if (next && (!runARef.current || !runBRef.current)) startDual();
    else restartNow();
  }, [startDual, restartNow]);

  const handleSeqToggleB = useCallback(() => {
    const next = !seqRefB.current;
    seqRefB.current = next ? seqStepsRefB.current : null;
    setSeqOnB(next);
    setSeqPosB(null); seqPosRefB.current = null;
    if (next && (!runARef.current || !runBRef.current)) startDual();
    else restartNow();
  }, [startDual, restartNow]);

  // ── persist settings ────────────────────────────────────────────────────────
  // only stable config, never live playback state — so this can't fire on
  // every beat tick, only when the user actually changes a setting
  const settingsSnapshot = useMemo(() => ({
    mode, relBase, relDeriv, relBpmBase, polyBpm, polyBeatsA, polyBeatsB, seqStepsA, seqStepsB, seqPresets,
    metA: { bpm:metA.bpm, baseBpm:metA.baseBpm, timeSig:metA.timeSig, subdivision:metA.subdivision, strongSound:metA.strongSound, weakSound:metA.weakSound, volume:metA.volume, muted:metA.muted, accentGroups:metA.accentGroups, subAccents:metA.subAccents },
    metB: { bpm:metB.bpm, baseBpm:metB.baseBpm, timeSig:metB.timeSig, subdivision:metB.subdivision, strongSound:metB.strongSound, weakSound:metB.weakSound, volume:metB.volume, muted:metB.muted, accentGroups:metB.accentGroups, subAccents:metB.subAccents },
   
  }), [mode, relBase, relDeriv, relBpmBase, polyBpm, polyBeatsA, polyBeatsB, seqStepsA, seqStepsB, seqPresets,
    metA.bpm, metA.baseBpm, metA.timeSig, metA.subdivision, metA.strongSound, metA.weakSound, metA.volume, metA.muted, metA.accentGroups, metA.subAccents,
    metB.bpm, metB.baseBpm, metB.timeSig, metB.subdivision, metB.strongSound, metB.weakSound, metB.volume, metB.muted, metB.accentGroups, metB.subAccents]);
  useEffect(() => {
    saveSettings(settingsSnapshot); // best-effort — private mode or quota just skips
  }, [settingsSnapshot]);

  // ── exportar a MIDI ─────────────────────────────────────────────────────────
  // Un .mid guarda posiciones en ticks, no tiempos reales, así que lo exportado
  // cae exacto sobre la grilla del DAW. Reemplazó a la salida MIDI en vivo, que
  // no podía ser exacta porque dependía del reloj del navegador.
  // metARef/metBRef en vez de metA/metB: tienen los valores efectivos que usa el
  // scheduler y no cambian en cada pulso, así que el callback queda estable.
  const [exportFlash, setExportFlash] = useState(false);
  const handleExport = useCallback(() => {
    const { bytes, fileName } = exportForState({
      mode, relBase, relDeriv, relBpmBase, polyBpm, polyBeatsA, polyBeatsB,
      metA: metARef.current, metB: metBRef.current,
      // con la secuencia encendida, lo que se exporta es la secuencia
      seqOnA, seqStepsA, seqOnB, seqStepsB,
      seqBpmA: metARef.current.bpm, seqBpmB: metBRef.current.bpm,
    });
    downloadMidi(bytes, fileName);
    setExportFlash(true);
    setTimeout(() => setExportFlash(false), 900);
  }, [mode, relBase, relDeriv, relBpmBase, polyBpm, polyBeatsA, polyBeatsB, seqOnA, seqStepsA, seqOnB, seqStepsB]);

  // Se deriva en vez de guardarse corregida: borrar un paso no deja la selección
  // colgada apuntando a un índice que ya no existe.
  const seqSelEffA = seqSelA != null && seqSelA < seqStepsA.length ? seqSelA : null;
  const seqSelEffB = seqSelB != null && seqSelB < seqStepsB.length ? seqSelB : null;

  useEffect(() => { seqSelRefA.current = seqSelEffA; seqSelRefB.current = seqSelEffB; });

  // Con un paso elegido, el editor de ACENTOS muestra y edita ESE compás, no el
  // que está sonando. Es un override de visualización: no toca lo que suena.
  const accentViewA = (seqOnA && seqSelEffA != null && seqStepsA[seqSelEffA])
    ? { total: seqStepsA[seqSelEffA].num, groups: seqStepsA[seqSelEffA].groups, step: seqSelEffA + 1 }
    : null;
  const accentViewB = (seqOnB && seqSelEffB != null && seqStepsB[seqSelEffB])
    ? { total: seqStepsB[seqSelEffB].num, groups: seqStepsB[seqSelEffB].groups, step: seqSelEffB + 1 }
    : null;

  // Qué paso edita el editor de acentos de cada voz: el elegido a mano manda, y
  // si no hay ninguno elegido, el que está sonando.
  const vistaPaso = (on, steps, sel, pos) => {
    if (!on) return null;
    const i = sel ?? pos?.stepIdx;
    const st = i != null ? steps[i] : null;
    return st ? { total: st.num, groups: st.groups, step: i + 1 } : null;
  };
  const seqAccentA = vistaPaso(seqOnA, seqStepsA, seqSelEffA, seqPosA);
  const seqAccentB = vistaPaso(seqOnB, seqStepsB, seqSelEffB, seqPosB);

  // Todo lo de la secuencia viaja junto: son catorce props que sólo le importan
  // a SequencePractice, y armarlas una vez evita repetirlas en los tres modos.
  const seqProps = {
    stepsA: seqStepsA, onStepsA: setSeqStepsA, onA: seqOnA, onToggleA: handleSeqToggleA,
    posA: seqPosA, selA: seqSelEffA, onSelA: setSeqSelA,
    stepsB: seqStepsB, onStepsB: setSeqStepsB, onB: seqOnB, onToggleB: handleSeqToggleB,
    posB: seqPosB, selB: seqSelEffB, onSelB: setSeqSelB,
    dobleDisponible: mode === "libre",
  };

  // ── render ─────────────────────────────────────────────────────────────────
  const isMetrica    = mode === "metrica";
  const isPolimetria = mode === "polimetria";
  // Con la secuencia encendida el anillo de A ya muestra los pulsos del compás
  // que suena, así que el centro tiene que decir ESE compás. Si sigue diciendo
  // la relación del modo, el número del centro contradice lo que se ve y lo que
  // se oye: un anillo de 9 pulsos debajo de un cartel que dice "6:4".
  const seqStepNow = seqOnA && seqPosA ? seqStepsA[seqPosA.stepIdx] : null;
  const modeLabel  = isMetrica ? `${relDeriv}:${relBase}` : isPolimetria ? `${polyBeatsA}:${polyBeatsB}` : undefined;
  const centerLabel = seqStepNow ? `${seqStepNow.num}/${seqStepNow.den}` : modeLabel;
  // phase-sync cycle ring targets — real pulse counts, no wall-clock timers
  const polyTarget = polyCycleTarget(polyBeatsA, polyBeatsB);
  const { targetA: libreCycleTargetA, targetB: libreCycleTargetB } = libreCycleTargets(metA.bpm, metB.bpm);
  // full-screen views — lights and circle are independent, mutually exclusive
  const lightsMode = flashOn && (runningA || runningB);
  const circleFsMode = circleFullscreen && (runningA || runningB);
  const performanceMode = lightsMode || circleFsMode;

  return (
    <div style={{ minHeight:"100vh", background:"#15171c", color:"#ddd", fontFamily:"system-ui,sans-serif", padding: performanceMode ? 0 : `${SP.xl}px ${SP.lg}px ${TRANSPORTE + SP.xl}px`, boxSizing:"border-box" }}>
      <BeatLights metA={metA} metB={metB} runningA={runningA} runningB={runningB} measuresA={measuresA} measuresB={measuresB} enabled={lightsMode} />
      {audioError && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, zIndex:2000,
          background:"#3d1010", borderBottom:"1px solid #ff4a4a", color:"#ffb4b4",
          fontFamily:"monospace", fontSize:FS.small, padding:"10px 16px",
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:SP.md,
        }}>
          <span>{audioError}</span>
          <button onClick={() => setAudioError(null)} style={{ background:"none", border:"none", color:"#ffb4b4", cursor:"pointer", fontSize:FS.body, lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
      )}
      {circleFsMode && (
        <div style={{ position:"fixed", inset:0, zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", background:"#15171c" }}>
          <div>
            {mode === "libre" ? (
              <CircularVisualizer ctxRef={ctxRef} pulsosA={pulsosA} pulsosB={pulsosB} metA={metA} metB={metB} runningA={runningA} runningB={runningB}
                centerLabel={centerLabel ?? `${metA.subdivision}:${metB.subdivision}`} showSubtitle={false} showMcm={false}
                totalAOverride={seqOnA ? undefined : metA.subdivision} totalBOverride={seqOnB ? undefined : metB.subdivision}
                beatAOverride={seqOnA ? undefined : metA.subTick} beatBOverride={seqOnB ? undefined : metB.subTick}
                durAOverride={60 / metA.bpm} durBOverride={60 / metB.bpm} vizStyle={vizStyle} fullscreen
                showCycleRing cycleTargetA={libreCycleTargetA} cycleTargetB={libreCycleTargetB}
                cyclePulseA={pulseCountA} cyclePulseB={pulseCountB} />
            ) : (
              <CircularVisualizer ctxRef={ctxRef} pulsosA={pulsosA} pulsosB={pulsosB} metA={metA} metB={metB} runningA={runningA} runningB={runningB} centerLabel={centerLabel} showSubtitle={false} showMcm={false} vizStyle={vizStyle} fullscreen
                showCycleRing={isPolimetria} cycleTargetA={polyTarget} cycleTargetB={polyTarget}
                cyclePulseA={pulseCountA} cyclePulseB={pulseCountA} />
            )}
          </div>
        </div>
      )}
      <FlashToggle on={flashOn} onToggle={() => setFlashOn((v) => { const n = !v; if (n) setCircleFullscreen(false); return n; })} />
      <CircleFullscreenToggle on={circleFullscreen} onToggle={() => setCircleFullscreen((v) => { const n = !v; if (n) setFlashOn(false); return n; })} />
      <button onClick={() => setVizStyle((v) => (v === "rings" ? "necklace" : v === "necklace" ? "tree" : "rings"))} title="Cambiar estilo de visualizador" style={{
        position:"fixed", top:16, left:16, zIndex:1000,
        width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center",
        background:"#ffd04a1a", border:"1px solid #ffd04a", borderRadius:RAD.lg,
        color:"#ffd04a", cursor:"pointer",
        boxShadow:"0 0 12px #ffd04a44",
      }}>
        {vizStyle === "rings" ? (
          <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        ) : vizStyle === "necklace" ? (
          <svg width="16" height="16" viewBox="0 0 16 16"><polygon points="8,1 15,6 12,15 4,15 1,6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        ) : (
          // Yggdrasil: copa arriba, raíces abajo, tronco cruzando el medio
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M8 1v14" />
            <path d="M8 4.5 4.5 7M8 4.5 11.5 7" />
            <path d="M8 11.5 4.5 9M8 11.5 11.5 9" />
            <path d="M4.5 7 2.5 9M4.5 7 6 9.2M11.5 7 13.5 9M11.5 7 10 9.2" />
          </svg>
        )}
      </button>
      <button onClick={handleExport} title="Exportar este patrón a un archivo MIDI" style={{
        position:"fixed", top:16, left:64, zIndex:1000,
        width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center",
        background: exportFlash ? "#4aff9a1a" : "#1e2028",
        border:`1px solid ${exportFlash ? "#4aff9a" : "#3a3d47"}`,
        borderRadius:RAD.lg, color: exportFlash ? "#4aff9a" : "#888", cursor:"pointer",
        boxShadow: exportFlash ? "0 0 12px #4aff9a44" : "none",
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 1.8v8.4" />
          <path d="M4.6 6.8 8 10.2l3.4-3.4" />
          <path d="M2.6 12.4v1.8h10.8v-1.8" />
        </svg>
      </button>
      <DualSwitch on={dualOn} onToggle={toggleDual} />
      {!performanceMode && (
      <>
      {/* header */}
      <div style={{ textAlign:"center", marginBottom:18 }}>
        <h1 style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:FS.lead, fontWeight:700, color:"#eee", margin:0, letterSpacing:4 }}>
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
          <div style={{ display:"flex", justifyContent:"center", maxWidth:ANCHO, margin:`0 auto ${SP.xl}px` }}>
            <CircularVisualizer ctxRef={ctxRef} pulsosA={pulsosA} pulsosB={pulsosB} metA={metA} metB={metB} runningA={runningA} runningB={runningB} centerLabel={centerLabel} showSubtitle={false} showMcm={false} vizStyle={vizStyle} />
          </div>
          <div style={{ maxWidth:ANCHO, margin:"0 auto 20px" }}>
            <PracticePanel onBpmChange={handlePracticeBpm} onActivate={handlePracticeActivate} running={runningA && runningB} status={practiceStatus} onStatus={updatePracticeStatus}
              seq={seqProps} presets={seqPresets} onSavePreset={handleSavePreset} onDeletePreset={handleDeletePreset} />
          </div>
          <div style={{ marginBottom:20 }}>
            <PoliPanel accentViewA={accentViewA} accentViewB={accentViewB}
              bpmBase={relBpmBase} base={relBase} derivado={relDeriv}
              onBpmBase={handleRelBpmBase} onBase={handleRelBase} onDeriv={handleRelDeriv}
              onTap={handleGlobalTap}
              metA={metA} metB={metB} onChangeA={changeMetA} onChangeB={changeMetB}
              bpmFlash={bpmFlash}
            />
          </div>
          <div style={{ marginBottom:90 }}>
            <SyncControls metA={metA} metB={metB} onChangeA={changeMetA} onChangeB={changeMetB} />
          </div>
        </>
      )}

      {/* ── POLIMETRÍA (tercer modo) ── */}
      {isPolimetria && (
        <>
          <div style={{ display:"flex", justifyContent:"center", maxWidth:ANCHO, margin:`0 auto ${SP.xl}px` }}>
            <CircularVisualizer ctxRef={ctxRef} pulsosA={pulsosA} pulsosB={pulsosB} metA={metA} metB={metB} runningA={runningA} runningB={runningB} centerLabel={centerLabel} showSubtitle={false} showMcm={false} vizStyle={vizStyle}
              showCycleRing cycleTargetA={polyTarget} cycleTargetB={polyTarget}
              cyclePulseA={pulseCountA} cyclePulseB={pulseCountA} />
          </div>
          <div style={{ maxWidth:ANCHO, margin:"0 auto 20px" }}>
            <PracticePanel onBpmChange={handlePracticeBpm} onActivate={handlePracticeActivate} running={runningA && runningB} status={practiceStatus} onStatus={updatePracticeStatus}
              seq={seqProps} presets={seqPresets} onSavePreset={handleSavePreset} onDeletePreset={handleDeletePreset} />
          </div>
          <div style={{ marginBottom:20 }}>
            <PolyMetriaPanel accentViewA={accentViewA} accentViewB={accentViewB}
              bpm={polyBpm} beatsA={polyBeatsA} beatsB={polyBeatsB}
              onBpm={handlePolyBpm} onBeatsA={handlePolyBeatsA} onBeatsB={handlePolyBeatsB}
              onTap={handlePolyTap}
              pulseCount={pulseCountA} running={runningA || runningB}
              metA={metA} metB={metB} onChangeA={changeMetA} onChangeB={changeMetB}
              bpmFlash={bpmFlash}
            />
          </div>
          <div style={{ marginBottom:90 }}>
            <SyncControls metA={metA} metB={metB} onChangeA={changeMetA} onChangeB={changeMetB} />
          </div>
        </>
      )}

      {/* ── DUAL LIBRE ── */}
      {mode === "libre" && (
        <>
          <div style={{ display:"flex", justifyContent:"center", maxWidth:ANCHO, margin:`0 auto ${SP.xl}px` }}>
            <CircularVisualizer ctxRef={ctxRef} pulsosA={pulsosA} pulsosB={pulsosB} metA={metA} metB={metB} runningA={runningA} runningB={runningB}
              centerLabel={centerLabel ?? `${metA.subdivision}:${metB.subdivision}`} showSubtitle={false} showMcm={false}
              totalAOverride={seqOnA ? undefined : metA.subdivision} totalBOverride={seqOnB ? undefined : metB.subdivision}
              beatAOverride={seqOnA ? undefined : metA.subTick} beatBOverride={seqOnB ? undefined : metB.subTick}
              durAOverride={60 / metA.bpm} durBOverride={60 / metB.bpm} vizStyle={vizStyle}
              showCycleRing cycleTargetA={libreCycleTargetA} cycleTargetB={libreCycleTargetB}
              cyclePulseA={pulseCountA} cyclePulseB={pulseCountB} />
          </div>
          <div style={{ maxWidth:ANCHO, margin:"0 auto 20px" }}>
            <PracticePanel onBpmChange={handlePracticeBpm} onActivate={handlePracticeActivate} running={runningA && runningB} status={practiceStatus} onStatus={updatePracticeStatus}
              seq={seqProps} presets={seqPresets} onSavePreset={handleSavePreset} onDeletePreset={handleDeletePreset} />
          </div>
          <div style={{ display:"flex", gap:SP.xl, flexWrap:"wrap", justifyContent:"center", maxWidth:ANCHO, margin:"0 auto 20px" }}>
            <MetronomePanel color="A" state={metA} onChange={changeMetA} running={runningA} onToggle={toggleA} measures={measuresA} bpmFlash={bpmFlash} accentView={seqAccentA} />
            <MetronomePanel color="B" state={metB} onChange={changeMetB} running={runningB} onToggle={toggleB} measures={measuresB} bpmFlash={bpmFlash} accentView={seqAccentB} />
          </div>
          <div style={{ maxWidth:ANCHO, margin:"0 auto" }}>
            <PhaseSyncInfo bpmA={metA.bpm} bpmB={metB.bpm} pulseCountA={pulseCountA} running={dualOn} />
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}
