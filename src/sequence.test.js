import { describe, it, expect } from "vitest";
import { normalizeStep, normalizeSequence, pulseSeconds, sequenceTotals, pulseAt, sequenceLabel, DEFAULT_SEQUENCE, DEN_VALUES, MAX_NUM, normalizePresets, savePreset, deletePreset, MAX_PRESETS, MAX_MEASURES } from './sequence.js';

// el ejemplo que pidió el usuario: 2 × 4/4, 3 × 3/4, 3 × 6/8 agrupado 3+3
const EJEMPLO = DEFAULT_SEQUENCE;

describe("normalizeStep", () => {
  it("rellena los campos que falten", () => {
    expect(normalizeStep({})).toEqual({ measures:1, num:4, den:4, groups:[4], muted:false });
  });

  it("recorta a los rangos de la app y cae en 4/4 ante basura", () => {
    expect(normalizeStep({ num: 99 }).num).toBe(MAX_NUM);
    expect(normalizeStep({ num: 0 }).num).toBe(1);
    expect(normalizeStep({ measures: 999 }).measures).toBe(64);
    expect(normalizeStep({ den: 5 }).den).toBe(4);      // 5 no es un denominador válido
    expect(normalizeStep({ num: "x" }).num).toBe(4);
  });

  it("conserva la agrupación sólo si suma los pulsos del compás", () => {
    expect(normalizeStep({ num: 8, groups: [3, 3, 2] }).groups).toEqual([3, 3, 2]);
    expect(normalizeStep({ num: 4, groups: [3, 3, 2] }).groups).toEqual([4]);
  });

  it("todos los denominadores de la lista sobreviven", () => {
    for (const den of DEN_VALUES) expect(normalizeStep({ den }).den).toBe(den);
  });
});

describe("normalizeSequence", () => {
  it("nunca devuelve una secuencia vacía", () => {
    expect(normalizeSequence([])).toHaveLength(1);
    expect(normalizeSequence(null)).toHaveLength(1);
    expect(normalizeSequence("no es una lista")).toHaveLength(1);
  });
});

describe("pulseSeconds", () => {
  it("el BPM manda sobre la negra: en x/8 el pulso dura la mitad", () => {
    expect(pulseSeconds(120, 4)).toBeCloseTo(0.5, 10);
    expect(pulseSeconds(120, 8)).toBeCloseTo(0.25, 10);
    expect(pulseSeconds(120, 2)).toBeCloseTo(1.0, 10);
    expect(pulseSeconds(120, 16)).toBeCloseTo(0.125, 10);
  });

  it("un 6/8 dura lo mismo que tres negras, no que seis", () => {
    // es la diferencia entre "cambia el compás" y "cambia el tempo"
    expect(6 * pulseSeconds(90, 8)).toBeCloseTo(3 * pulseSeconds(90, 4), 10);
  });
});

describe("sequenceTotals", () => {
  it("cuenta pulsos, compases y segundos de una vuelta", () => {
    const t = sequenceTotals(EJEMPLO, 90);
    expect(t.measures).toBe(8);                 // 2 + 3 + 3
    expect(t.pulses).toBe(2*4 + 3*3 + 3*6);     // 8 + 9 + 18 = 35
    // en negras: 8 + 9 + 9 = 26
    expect(t.seconds).toBeCloseTo(26 * (60 / 90), 10);
  });

  it("la suma de los pulsos uno por uno da el total de segundos", () => {
    for (const bpm of [40, 90, 120, 240]) {
      const t = sequenceTotals(EJEMPLO, bpm);
      let suma = 0;
      for (let i = 0; i < t.pulses; i++) suma += pulseAt(i, EJEMPLO, bpm).seconds;
      expect(suma).toBeCloseTo(t.seconds, 9);
    }
  });
});

describe("pulseAt", () => {
  it("recorre el ejemplo paso por paso", () => {
    const p = (i) => pulseAt(i, EJEMPLO, 90);
    expect(p(0)).toMatchObject({ stepIdx:0, measureInStep:0, pulseInMeasure:0, num:4, den:4, accent:"strong" });
    expect(p(3)).toMatchObject({ stepIdx:0, measureInStep:0, pulseInMeasure:3, accent:"normal" });
    expect(p(4)).toMatchObject({ stepIdx:0, measureInStep:1, pulseInMeasure:0, accent:"strong" });
    expect(p(8)).toMatchObject({ stepIdx:1, measureInStep:0, pulseInMeasure:0, num:3, den:4 });
    expect(p(17)).toMatchObject({ stepIdx:2, measureInStep:0, pulseInMeasure:0, num:6, den:8 });
  });

  it("el 6/8 agrupado 3+3 acentúa el 1 y el 4, nada más", () => {
    const acentos = [];
    for (let i = 17; i < 23; i++) acentos.push(pulseAt(i, EJEMPLO, 90).accent);
    expect(acentos).toEqual(["strong", "normal", "normal", "group", "normal", "normal"]);
  });

  it("da la vuelta solo: el pulso siguiente al último es el 1 del paso 1", () => {
    const { pulses } = sequenceTotals(EJEMPLO);
    expect(pulseAt(pulses, EJEMPLO, 90)).toMatchObject({ stepIdx:0, measureInStep:0, pulseInMeasure:0 });
    expect(pulseAt(pulses * 7 + 4, EJEMPLO, 90)).toMatchObject({ stepIdx:0, measureInStep:1, pulseInMeasure:0 });
  });

  it("aguanta índices negativos sin salirse de la secuencia", () => {
    expect(pulseAt(-1, EJEMPLO, 90)).toMatchObject({ stepIdx:2, pulseInMeasure:5 });
  });

  it("measureInCycle cuenta los compases de toda la vuelta, no los del paso", () => {
    expect(pulseAt(0,  EJEMPLO, 90).measureInCycle).toBe(0);
    expect(pulseAt(8,  EJEMPLO, 90).measureInCycle).toBe(2);   // primer compás del paso 2
    expect(pulseAt(17, EJEMPLO, 90).measureInCycle).toBe(5);   // primer compás del paso 3
  });

  it("un paso mudo marca muted y sigue ocupando su tiempo", () => {
    const steps = [{ measures:1, num:4, den:4 }, { measures:1, num:4, den:4, muted:true }];
    expect(pulseAt(0, steps, 120).muted).toBe(false);
    expect(pulseAt(4, steps, 120).muted).toBe(true);
    expect(pulseAt(4, steps, 120).seconds).toBeCloseTo(pulseAt(0, steps, 120).seconds, 10);
    expect(sequenceTotals(steps, 120).pulses).toBe(8);
  });

  it("recorre cualquier secuencia sin huecos ni saltos", () => {
    // barrido: el pulso N+1 es siempre el siguiente pulso del compás, o el 1 del
    // compás siguiente — nunca un salto
    const casos = [
      EJEMPLO,
      [{ measures:1, num:21, den:16, groups:[3,3,3,3,3,3,3] }],
      [{ measures:4, num:7, den:8, groups:[2,2,3] }, { measures:2, num:1, den:1 }],
      [{ measures:2, num:5, den:4 }, { measures:1, num:3, den:8 }, { measures:3, num:2, den:2 }],
    ];
    for (const steps of casos) {
      const { pulses } = sequenceTotals(steps);
      for (let i = 0; i < pulses; i++) {
        const a = pulseAt(i, steps, 100), b = pulseAt(i + 1, steps, 100);
        expect(a.pulseInMeasure).toBeLessThan(a.num);
        if (a.pulseInMeasure + 1 < a.num) {
          expect(b.pulseInMeasure).toBe(a.pulseInMeasure + 1);
          expect(b.stepIdx).toBe(a.stepIdx);
        } else {
          expect(b.pulseInMeasure).toBe(0); // arranca compás nuevo
        }
      }
    }
  });
});

describe("sequenceLabel", () => {
  it("resume la secuencia en una línea", () => {
    expect(sequenceLabel(EJEMPLO)).toBe("2×4/4 · 3×3/4 · 3×6/8");
  });
});

// ── presets ──────────────────────────────────────────────────────────────────
describe('presets de secuencias', () => {
  const a = [{ measures: 2, num: 4, den: 4 }];
  const b = [{ measures: 3, num: 7, den: 8 }];

  it('guarda con nombre y devuelve la secuencia normalizada', () => {
    const l = savePreset([], 'Songo', a);
    expect(l).toHaveLength(1);
    expect(l[0].name).toBe('Songo');
    expect(l[0].steps[0]).toMatchObject({ measures: 2, num: 4, den: 4, muted: false });
  });

  it('guardar con un nombre que ya existe lo pisa, no lo duplica', () => {
    let l = savePreset([], 'Songo', a);
    l = savePreset(l, 'songo', b); // mismo nombre, otra caja
    expect(l).toHaveLength(1);
    expect(l[0].steps[0].num).toBe(7);
  });

  it('ignora nombres vacíos y secuencias vacías', () => {
    expect(savePreset([], '   ', a)).toHaveLength(0);
    expect(normalizePresets([{ name: 'x', steps: [] }])).toHaveLength(0);
    expect(normalizePresets(null)).toEqual([]);
  });

  it('borra por nombre sin importar mayúsculas', () => {
    const l = savePreset(savePreset([], 'Uno', a), 'Dos', b);
    expect(deletePreset(l, 'UNO').map((p) => p.name)).toEqual(['Dos']);
  });

  it('sanea un preset guardado por una versión vieja', () => {
    const l = normalizePresets([{ name: 'raro', steps: [{ measures: 999, num: 99, den: 7 }] }]);
    expect(l[0].steps[0]).toMatchObject({ measures: MAX_MEASURES, num: MAX_NUM, den: 4 });
  });

  it('corta en MAX_PRESETS', () => {
    const muchos = Array.from({ length: MAX_PRESETS + 10 }, (_, i) => ({ name: `p${i}`, steps: a }));
    expect(normalizePresets(muchos)).toHaveLength(MAX_PRESETS);
  });
});
