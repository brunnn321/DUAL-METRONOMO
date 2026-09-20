import { describe, it, expect } from "vitest";
import {
  DUR, EASE, salida, decay,
  BUFFER, crearBuffer, anotarPulso, limpiarBuffer, pulsoEn, fraccionEntrePulsos,
} from "./motion.js";

describe("fichas de movimiento", () => {
  it("lo que se apaga dura menos que lo que se enciende", () => {
    expect(salida(DUR.base)).toBeLessThan(DUR.base);
    expect(salida(200)).toBe(130); // 65 %
  });

  it("las tres curvas están definidas y la de avance constante es lineal", () => {
    expect(EASE.lineal).toBe("linear");
    expect(EASE.entra).toMatch(/^cubic-bezier/);
    expect(EASE.sale).toMatch(/^cubic-bezier/);
  });
});

describe("decay", () => {
  it("enciende al máximo en el instante del golpe", () => {
    expect(decay(0)).toBe(1);
  });

  it("cae hasta cero al terminar su vida y no se pasa de largo", () => {
    expect(decay(0.4, 0.4)).toBe(0);
    expect(decay(10, 0.4)).toBe(0);
  });

  it("decrece siempre, nunca rebota", () => {
    let previo = Infinity;
    for (let t = 0; t <= 0.4; t += 0.02) {
      const v = decay(t, 0.4);
      expect(v).toBeLessThanOrEqual(previo);
      previo = v;
    }
  });

  it("un tiempo negativo o inválido no enciende nada", () => {
    expect(decay(-1)).toBe(0);
    expect(decay(NaN)).toBe(0);
    expect(decay(undefined)).toBe(0);
  });
});

describe("búfer de pulsos", () => {
  const pulso = (t, idx) => ({ t, idx, paso: 0.5 });

  it("arranca vacío y no encuentra nada", () => {
    expect(pulsoEn(crearBuffer(), 1)).toBeNull();
  });

  it("devuelve el último pulso que ya sonó, no el que viene", () => {
    const b = crearBuffer();
    [0, 0.5, 1.0, 1.5].forEach((t, i) => anotarPulso(b, pulso(t, i)));
    const r = pulsoEn(b, 1.2);
    expect(r.pulso.idx).toBe(2);           // el de t=1.0
    expect(r.desde).toBeCloseTo(0.2, 6);
  });

  it("no devuelve pulsos del futuro", () => {
    const b = crearBuffer();
    anotarPulso(b, pulso(5, 0));
    expect(pulsoEn(b, 1)).toBeNull();
  });

  it("es circular: pisa los viejos y sigue encontrando el correcto", () => {
    const b = crearBuffer();
    for (let i = 0; i < BUFFER * 2; i++) anotarPulso(b, pulso(i * 0.5, i));
    const ultimo = (BUFFER * 2 - 1) * 0.5;
    expect(pulsoEn(b, ultimo).pulso.idx).toBe(BUFFER * 2 - 1);
    expect(b.items.filter(Boolean)).toHaveLength(BUFFER);
  });

  it("limpiarBuffer lo deja como nuevo", () => {
    const b = crearBuffer();
    anotarPulso(b, pulso(0, 0));
    limpiarBuffer(b);
    expect(b.n).toBe(0);
    expect(pulsoEn(b, 1)).toBeNull();
  });
});

describe("fraccionEntrePulsos", () => {
  const pulso = (t, idx) => ({ t, idx, paso: 0.5 });

  it("interpola entre dos pulsos en vez de saltar", () => {
    const b = crearBuffer();
    anotarPulso(b, pulso(0, 0));
    anotarPulso(b, pulso(0.5, 1));
    expect(fraccionEntrePulsos(b, 0)).toBeCloseTo(0, 6);
    expect(fraccionEntrePulsos(b, 0.25)).toBeCloseTo(0.5, 6);
    expect(fraccionEntrePulsos(b, 0.49)).toBeCloseTo(0.98, 6);
  });

  it("usa el paso anotado cuando todavía no hay pulso siguiente", () => {
    const b = crearBuffer();
    anotarPulso(b, pulso(0, 0));
    expect(fraccionEntrePulsos(b, 0.25)).toBeCloseTo(0.5, 6);
  });

  it("nunca se sale de 0 a 1", () => {
    const b = crearBuffer();
    anotarPulso(b, pulso(0, 0));
    expect(fraccionEntrePulsos(b, 99)).toBe(1);
    expect(fraccionEntrePulsos(b, -5)).toBe(0);
  });
});
