// Exportación a Standard MIDI File.
//
// Un .mid guarda posiciones en ticks de una grilla, no tiempos reales, así que
// no puede tener jitter: lo que se exporta cae exacto sobre la grilla del DAW.
// Por eso la app exporta archivos en vez de mandar notas MIDI en vivo.
//
// La clave de la exactitud es elegir el PPQ (ticks por negra) según los números
// del patrón, no fijarlo en el 960 habitual: con 960 un 4:7 da 548.57 ticks por
// pulso y hay redondeo. `pickPpq` calcula el mínimo común múltiplo de los
// denominadores que hagan falta y elige un PPQ múltiplo de eso.

import { accentSet, effectiveGroups } from './phase.js';

export const MAX_PPQ    = 32767; // límite del campo "division" en la cabecera SMF
export const TARGET_PPQ = 1920;  // resolución a la que se apunta si los divisores lo permiten
export const NOTE_A     = 36;    // C2
export const NOTE_B     = 48;    // C3 — una octava arriba de A
// Tres niveles, los mismos que distingue el scheduler: el 1 del ciclo, los
// arranques de grupo de una métrica aditiva (3+3+2 acentúa también el 4 y el 7)
// y el resto de los pulsos.
export const VEL_ACCENT = 110;
export const VEL_SUB    = 95;
export const VEL_NORMAL = 80;

export const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));
export const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);

// Fracción reducida — los pasos entre pulsos se llevan como racionales exactos
// (en negras) y recién al final se convierten a ticks, para no arrastrar error
// de punto flotante desde bpm derivados como 90 × 5/4 = 112.5.
export function frac(n, d) {
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

// PPQ múltiplo de todos los denominadores, lo más cerca de TARGET_PPQ posible.
// `exact:false` avisa que los divisores no entran en el rango de un SMF y que
// va a haber redondeo (no debería pasar con los rangos de la app).
export function pickPpq(denominators) {
  let d = 1;
  for (const x of denominators) d = lcm(d, Math.max(1, Math.round(x)));
  if (d > MAX_PPQ) return { ppq: TARGET_PPQ, exact: false };
  const mult = Math.max(1, Math.floor(TARGET_PPQ / d));
  let ppq = d * mult;
  if (ppq > MAX_PPQ) ppq = d;
  return { ppq, exact: true };
}

// ── escritura binaria SMF ────────────────────────────────────────────────────
function vlq(n) {
  const b = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) { b.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  return b;
}
const ascii = (s) => [...s].map((c) => c.charCodeAt(0) & 0x7f);
function chunk(id, data) {
  const len = data.length;
  return [...ascii(id), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data];
}
function metaText(type, text) {
  const bytes = ascii(text).slice(0, 127);
  return [...vlq(0), 0xff, type, bytes.length, ...bytes];
}

// Convierte una lista de eventos {tick, order, data} en un chunk MTrk.
function buildTrack(events, name) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes = [...metaText(0x03, name)];
  let last = 0;
  for (const e of events) { bytes.push(...vlq(e.tick - last), ...e.data); last = e.tick; }
  bytes.push(...vlq(0), 0xff, 0x2f, 0x00);
  return chunk('MTrk', bytes);
}

/**
 * Genera un Standard MIDI File formato 1: una pista de tempo/compás más una
 * pista por cada voz, cada una en su propio canal para que caigan separadas
 * al importarlas en el DAW.
 *
 * @param {object}   o
 * @param {number}   o.bpm         negras por minuto de la pista de tempo
 * @param {number}   o.ppq         ticks por negra (ver pickPpq)
 * @param {number}   o.timeSigNum  numerador del compás (denominador siempre 4)
 * @param {number}   o.totalTicks  largo total del archivo
 * @param {Array}    o.tracks      [{ name, channel, note, stepTicks, count, accents, cycleLen }]
 *   `accents` es el conjunto de índices acentuados dentro del ciclo y `cycleLen`
 *   el largo del ciclo. Un número suelto no alcanza: una métrica aditiva acentúa
 *   {0,3,6} sobre 8, no "cada 8".
 * @returns {Uint8Array}
 */
export function buildMidiFile({ bpm, ppq, timeSigNum = 4, totalTicks, tracks }) {
  const usPerQuarter = Math.round(60000000 / bpm);
  // duración de nota corta y fija, pero nunca más larga que medio paso ni menor a 1 tick
  const minStep = Math.min(...tracks.map((t) => t.stepTicks));
  const noteLen = Math.max(1, Math.min(Math.round(ppq / 8), Math.floor(minStep / 2)));

  const tempoTrack = [
    ...metaText(0x03, 'tempo'),
    ...vlq(0), 0xff, 0x58, 0x04, timeSigNum, 0x02, 0x18, 0x08,
    ...vlq(0), 0xff, 0x51, 0x03,
    (usPerQuarter >>> 16) & 255, (usPerQuarter >>> 8) & 255, usPerQuarter & 255,
    ...vlq(totalTicks), 0xff, 0x2f, 0x00,
  ];

  const chunks = [chunk('MTrk', tempoTrack)];
  for (const t of tracks) {
    const ev = [];
    const cycleLen = Math.max(1, Math.round(t.cycleLen || 1));
    const accents = t.accents instanceof Set ? t.accents : new Set([0]);
    for (let i = 0; i < t.count; i++) {
      const tick = Math.round(i * t.stepTicks);
      const k = i % cycleLen;
      const vel = k === 0 ? VEL_ACCENT : accents.has(k) ? VEL_SUB : VEL_NORMAL;
      ev.push({ tick,           order: 1, data: [0x90 | t.channel, t.note, vel] });
      ev.push({ tick: tick + noteLen, order: 0, data: [0x80 | t.channel, t.note, 0] });
    }
    chunks.push(buildTrack(ev, t.name));
  }

  const header = chunk('MThd', [0, 1, 0, chunks.length, (ppq >>> 8) & 255, ppq & 255]);
  return Uint8Array.from([...header, ...chunks.flat()]);
}

// ── traducción del estado de la app a un archivo ─────────────────────────────

const MAX_QUARTERS = 256; // techo de largo, para no generar archivos enormes

// Acentos de una voz, leídos igual que en el scheduler: los grupos guardados
// solo valen mientras sumen el total del ciclo, y si no, el ciclo es plano.
const accentsFor = (groups, total) => accentSet(effectiveGroups(groups, total));
// "3+3+2" en el nombre de la pista, para que la agrupación se vea en el DAW.
const groupLabel = (groups, total) => {
  const g = effectiveGroups(groups, total);
  return g.length > 1 ? ` ${g.join('+')}` : '';
};

/**
 * Arma el archivo que corresponde a lo que la app está configurada para tocar.
 * `state` viene del componente:
 *   modo "metrica":    { mode, relBase, relDeriv, relBpmBase }
 *   modo "polimetria": { mode, polyBpm, polyBeatsA, polyBeatsB }
 *   modo "libre":      { mode, metA:{bpm,subdivision}, metB:{bpm,subdivision} }
 * En los tres, `metA`/`metB` aportan además la agrupación de acentos:
 * `accentGroups` sobre los pulsos del compás y `subAccents` sobre la subdivisión.
 * @returns {{ bytes: Uint8Array, fileName: string, exact: boolean }}
 */
export function exportForState(state) {
  const spec = specForState(state);
  const bytes = buildMidiFile(spec);
  return { bytes, fileName: spec.fileName, exact: spec.exact };
}

export function specForState(state) {
  if (state.mode === 'metrica')    return specMetrica(state);
  if (state.mode === 'polimetria') return specPolimetria(state);
  return specLibre(state);
}

// DUAL SINC: A y B abarcan el mismo ciclo. A pone `base` pulsos, B pone `deriv`.
// El ciclo dura `base` negras al tempo base, así que el paso de B es base/deriv negras.
function specMetrica({ relBase, relDeriv, relBpmBase, metA = {}, metB = {} }) {
  const base = Math.max(1, Math.round(relBase));
  const deriv = Math.max(1, Math.round(relDeriv));
  const bpm = relBpmBase;
  const stepB = frac(base, deriv);                 // negras por pulso de B
  const { ppq, exact } = pickPpq([1, stepB.d]);
  const cycles = Math.max(1, Math.min(8, Math.floor(MAX_QUARTERS / base)));
  const totalTicks = base * cycles * ppq;
  return {
    bpm, ppq, timeSigNum: base, totalTicks, exact,
    fileName: `dualpulse-${deriv}-${relBase}-${bpm}bpm.mid`,
    tracks: [
      { name: `A - ${base} pulsos${groupLabel(metA.accentGroups, base)} (nota ${NOTE_A})`,
        channel: 0, note: NOTE_A,
        stepTicks: ppq, count: base * cycles,
        accents: accentsFor(metA.accentGroups, base), cycleLen: base },
      { name: `B - ${deriv} pulsos${groupLabel(metB.accentGroups, deriv)} (nota ${NOTE_B})`,
        channel: 1, note: NOTE_B,
        stepTicks: (ppq * stepB.n) / stepB.d, count: deriv * cycles,
        accents: accentsFor(metB.accentGroups, deriv), cycleLen: deriv },
    ],
  };
}

// POLIMETRÍA: mismo BPM, ciclos de distinto largo. Los dos pulsan cada negra;
// lo que difiere es cada cuántos pulsos cae el acento. Vuelven a coincidir
// cada mcm(A,B) negras.
function specPolimetria({ polyBpm, polyBeatsA, polyBeatsB, metA = {}, metB = {} }) {
  const a = Math.max(1, Math.round(polyBeatsA));
  const b = Math.max(1, Math.round(polyBeatsB));
  const bpm = polyBpm;
  const { ppq, exact } = pickPpq([1]);
  const cycleQuarters = lcm(a, b);
  const cycles = Math.max(1, Math.min(4, Math.floor(MAX_QUARTERS / cycleQuarters)));
  const pulses = cycleQuarters * cycles;
  return {
    bpm, ppq, timeSigNum: a, totalTicks: pulses * ppq, exact,
    fileName: `dualpulse-polimetria-${a}-${b}-${bpm}bpm.mid`,
    tracks: [
      { name: `A - acento cada ${a}${groupLabel(metA.accentGroups, a)} (nota ${NOTE_A})`,
        channel: 0, note: NOTE_A,
        stepTicks: ppq, count: pulses,
        accents: accentsFor(metA.accentGroups, a), cycleLen: a },
      { name: `B - acento cada ${b}${groupLabel(metB.accentGroups, b)} (nota ${NOTE_B})`,
        channel: 1, note: NOTE_B,
        stepTicks: ppq, count: pulses,
        accents: accentsFor(metB.accentGroups, b), cycleLen: b },
    ],
  };
}

// DUAL LIBRE: dos tempos independientes. El archivo lleva el tempo de A; B se
// expresa como un paso de bpmA/bpmB negras. Se respetan las subdivisiones
// (FIGURAS), con acento fuerte en cada pulso principal y acento intermedio en
// los arranques de grupo de la subdivisión (subAccents) — que es lo que hace el
// scheduler en este modo, donde timeSig está fijo en 1/4.
function specLibre({ metA, metB }) {
  const bpmA = Math.max(1, Math.round(metA.bpm));
  const bpmB = Math.max(1, Math.round(metB.bpm));
  const subA = Math.max(1, Math.round(metA.subdivision || 1));
  const subB = Math.max(1, Math.round(metB.subdivision || 1));
  const stepA = frac(1, subA);              // negras por tick de A
  const stepB = frac(bpmA, bpmB * subB);    // negras por tick de B
  const { ppq, exact } = pickPpq([stepA.d, stepB.d]);
  const tickA = (ppq * stepA.n) / stepA.d;
  const tickB = (ppq * stepB.n) / stepB.d;

  // Los dos tempos son libres, así que no hay un ciclo común garantizado: se
  // apunta a cubrir ~8 pulsos del lado más lento, con un piso de 16 compases y
  // un techo para no generar archivos gigantes con relaciones extremas
  // (el rango de BPM de la app es 1-600, así que 600 contra 1 es alcanzable).
  const lento = Math.max(tickA, tickB);
  const planeado = Math.min(MAX_QUARTERS, Math.max(64, Math.ceil((8 * lento) / ppq))) * ppq;
  const countA = Math.max(2, Math.floor(planeado / tickA));
  const countB = Math.max(2, Math.floor(planeado / tickB));
  // el fin de pista nunca puede quedar antes de la última nota
  const totalTicks = Math.max(planeado, (countA - 1) * tickA, (countB - 1) * tickB) + ppq;

  return {
    bpm: bpmA, ppq, timeSigNum: 4, totalTicks, exact,
    fileName: `dualpulse-libre-${bpmA}-${bpmB}bpm.mid`,
    tracks: [
      { name: `A - ${bpmA} BPM${groupLabel(metA.subAccents, subA)} (nota ${NOTE_A})`,
        channel: 0, note: NOTE_A,
        stepTicks: tickA, count: countA,
        accents: accentsFor(metA.subAccents, subA), cycleLen: subA },
      { name: `B - ${bpmB} BPM${groupLabel(metB.subAccents, subB)} (nota ${NOTE_B})`,
        channel: 1, note: NOTE_B,
        stepTicks: tickB, count: countB,
        accents: accentsFor(metB.subAccents, subB), cycleLen: subB },
    ],
  };
}

// Parte impura: dispara la descarga en el navegador. Se mantiene fuera de todo
// lo de arriba para que el generador se pueda testear sin DOM.
export function downloadMidi(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
