// Secuencia de compases: una lista de pasos que se repite en loop.
//
//   [{ measures: 2, num: 4, den: 4 }, { measures: 3, num: 3, den: 4 }, ...]
//
// "2 compases de 4/4, después 3 de 3/4, después 3 de 6/8, y vuelve al principio".
// Todo acá es cálculo puro, sin React y sin audio, para poder testearlo igual que
// phase.js: el scheduler sólo pregunta "qué toca en el pulso N".
//
// Decisión de fondo: **el BPM siempre se refiere a la negra.** En 6/8 el click va
// en la corchea, o sea al doble de velocidad que en 4/4 al mismo BPM. Lo que
// cambia al cambiar de compás no es la velocidad del pulso, sino cuántos pulsos
// entran antes del acento. Es lo que se lee en una partitura y lo que ya escribe
// el .mid.

import { accentSet, effectiveGroups } from "./phase.js";

export const DEN_VALUES = [1, 2, 4, 8, 16]; // denominadores que se pueden elegir
export const MAX_NUM      = 21;  // mismo techo que el resto de la app (aksak llega a 21)
export const MAX_MEASURES = 64;

// El ejemplo que pidió el usuario, como secuencia por defecto.
export const DEFAULT_SEQUENCE = [
  { measures: 2, num: 4, den: 4 },
  { measures: 3, num: 3, den: 4 },
  { measures: 3, num: 6, den: 8, groups: [3, 3] },
];

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

// Un paso siempre queda con todos sus campos y dentro de rango, para que el
// scheduler nunca tenga que defenderse de datos guardados de otra versión.
export function normalizeStep(step) {
  const s = step || {};
  const num = clampInt(s.num, 1, MAX_NUM, 4);
  const den = DEN_VALUES.includes(Math.round(Number(s.den))) ? Math.round(Number(s.den)) : 4;
  return {
    measures: clampInt(s.measures, 1, MAX_MEASURES, 1),
    num,
    den,
    // los grupos sólo valen si suman los pulsos del compás — mismo criterio que
    // usa el scheduler para los acentos aditivos
    groups: effectiveGroups(s.groups, num),
    muted: !!s.muted,
  };
}

export function normalizeSequence(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const out = list.slice(0, 32).map(normalizeStep);
  return out.length ? out : [normalizeStep({})];
}

// Segundos que dura un pulso. Único lugar donde vive la relación negra/denominador.
export const pulseSeconds = (bpm, den) =>
  (60 / Math.max(1, Number(bpm) || 1)) * (4 / (den || 4));

// Pulsos, compases y segundos de una vuelta completa a la secuencia.
export function sequenceTotals(steps, bpm = 120) {
  const list = normalizeSequence(steps);
  let pulses = 0, measures = 0, seconds = 0;
  for (const s of list) {
    pulses   += s.measures * s.num;
    measures += s.measures;
    seconds  += s.measures * s.num * pulseSeconds(bpm, s.den);
  }
  return { pulses, measures, seconds };
}

/**
 * Qué toca en el pulso `index` (0-based, absoluto y sin techo: da la vuelta solo).
 * Es lo único que el scheduler necesita preguntar.
 *
 * @returns {{
 *   stepIdx: number, measureInStep: number, pulseInMeasure: number,
 *   num: number, den: number, muted: boolean,
 *   accent: "strong"|"group"|"normal", seconds: number
 * }}
 */
export function pulseAt(index, steps, bpm = 120) {
  const list = normalizeSequence(steps);
  const { pulses } = sequenceTotals(list);
  if (pulses <= 0) return null;

  let i = ((Math.floor(index) % pulses) + pulses) % pulses;
  let barsBefore = 0;
  for (let s = 0; s < list.length; s++) {
    const st = list[s];
    const len = st.measures * st.num;
    if (i < len) {
      const pulseInMeasure = i % st.num;
      const measureInStep = Math.floor(i / st.num);
      const acc = accentSet(st.groups);
      return {
        stepIdx: s,
        measureInStep,
        measureInCycle: barsBefore + measureInStep, // 0-based, para el contador de compases
        pulseInMeasure,
        num: st.num,
        den: st.den,
        groups: st.groups,
        muted: st.muted,
        accent: pulseInMeasure === 0 ? "strong" : acc.has(pulseInMeasure) ? "group" : "normal",
        seconds: pulseSeconds(bpm, st.den),
      };
    }
    i -= len;
    barsBefore += st.measures;
  }
  return null;
}

// Resumen de una línea para la barra colapsada: "2×4/4 · 3×3/4 · 3×6/8".
export const sequenceLabel = (steps) =>
  normalizeSequence(steps).map((s) => `${s.measures}×${s.num}/${s.den}`).join(" · ");
