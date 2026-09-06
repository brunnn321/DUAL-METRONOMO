import { describe, it, expect } from "vitest";
import {
  frac, pickPpq, gcd, lcm, buildMidiFile, specForState, exportForState,
  NOTE_A, NOTE_B, VEL_ACCENT, VEL_NORMAL, MAX_PPQ,
} from "./midiExport.js";

// ── parser SMF independiente del generador ───────────────────────────────────
// Deliberadamente NO reusa nada de midiExport.js: si el generador y el lector
// compartieran código, un error de formato pasaría desapercibido en los dos.
function parseMidi(bytes) {
  let p = 0;
  const str = (n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p++]); return s; };
  const u32 = () => { const v = (bytes[p] << 24) | (bytes[p+1] << 16) | (bytes[p+2] << 8) | bytes[p+3]; p += 4; return v >>> 0; };
  const u16 = () => { const v = (bytes[p] << 8) | bytes[p+1]; p += 2; return v; };

  expect(str(4)).toBe("MThd");
  const headerLen = u32();
  const format = u16(), ntrks = u16(), ppq = u16();
  p += headerLen - 6;

  const tracks = [];
  let usPerQuarter = null, timeSig = null;
  for (let i = 0; i < ntrks; i++) {
    expect(str(4)).toBe("MTrk");
    const chunkLen = u32();   // u32() avanza p, así que el largo va antes de calcular el fin
    const end = p + chunkLen;
    let tick = 0, running = null, name = null;
    const notes = [], offs = [];
    while (p < end) {
      let delta = 0, b;
      do { b = bytes[p++]; delta = delta * 128 + (b & 0x7f); } while (b & 0x80);
      tick += delta;
      let st = bytes[p];
      if (st < 0x80) st = running; else { p++; running = st; }
      if (st === 0xff) {
        const type = bytes[p++];
        let len = 0, c;
        do { c = bytes[p++]; len = len * 128 + (c & 0x7f); } while (c & 0x80);
        const d = bytes.slice(p, p + len); p += len;
        if (type === 0x51) usPerQuarter = (d[0] << 16) | (d[1] << 8) | d[2];
        if (type === 0x58) timeSig = { num: d[0], den: 1 << d[1] };
        if (type === 0x03) name = String.fromCharCode(...d);
      } else if (st === 0xf0 || st === 0xf7) {
        let len = 0, c;
        do { c = bytes[p++]; len = len * 128 + (c & 0x7f); } while (c & 0x80);
        p += len;
      } else {
        const hi = st & 0xf0;
        const n = bytes[p++];
        const v = (hi === 0xc0 || hi === 0xd0) ? 0 : bytes[p++];
        if (hi === 0x90 && v > 0) notes.push({ tick, ch: (st & 0x0f) + 1, note: n, vel: v });
        if (hi === 0x80 || (hi === 0x90 && v === 0)) offs.push({ tick, note: n });
      }
    }
    p = end;
    tracks.push({ name, notes, offs });
  }
  return { format, ntrks, ppq, usPerQuarter, timeSig, tracks };
}

const steps = (ticks) => [...new Set(ticks.slice(1).map((t, i) => t - ticks[i]))];

describe("frac / pickPpq", () => {
  it("reduce fracciones", () => {
    expect(frac(4, 8)).toEqual({ n: 1, d: 2 });
    expect(frac(90, 120)).toEqual({ n: 3, d: 4 });
    expect(frac(3, 7)).toEqual({ n: 3, d: 7 });
  });

  it("gcd y lcm", () => {
    expect(gcd(12, 18)).toBe(6);
    expect(lcm(4, 6)).toBe(12);
  });

  it("elige un PPQ divisible por todos los denominadores", () => {
    for (const dens of [[1], [3], [5], [7], [3, 5], [5, 7], [8, 7], [4, 15]]) {
      const { ppq, exact } = pickPpq(dens);
      expect(exact).toBe(true);
      expect(ppq).toBeLessThanOrEqual(MAX_PPQ);
      for (const d of dens) expect(ppq % d).toBe(0);
    }
  });

  it("con 7 en juego NO elige el 960 habitual, que redondearía", () => {
    // 960 no es divisible por 7: un 4:7 sobre PPQ 960 caería en 548.57 ticks
    expect(960 % 7).not.toBe(0);
    expect(pickPpq([7]).ppq % 7).toBe(0);
  });
});

describe("cabecera del archivo", () => {
  it("es formato 1 con pista de tempo + dos voces, al tempo y compás pedidos", () => {
    const { bytes } = exportForState({ mode: "metrica", relBase: 4, relDeriv: 5, relBpmBase: 90 });
    const m = parseMidi(bytes);
    expect(m.format).toBe(1);
    expect(m.ntrks).toBe(3);
    // el SMF guarda microsegundos por negra como entero, así que 90 BPM no es
    // representable al infinito: 666666.67 -> 666667. El error es ~5e-7 relativo.
    expect(60000000 / m.usPerQuarter).toBeCloseTo(90, 3);
    expect(m.timeSig).toEqual({ num: 4, den: 4 });
    expect(m.tracks[1].notes.every((n) => n.ch === 1 && n.note === NOTE_A)).toBe(true);
    expect(m.tracks[2].notes.every((n) => n.ch === 2 && n.note === NOTE_B)).toBe(true);
  });

  it("A y B quedan a una octava exacta", () => {
    expect(NOTE_B - NOTE_A).toBe(12);
  });

  it("las notas no se solapan con la siguiente del mismo track", () => {
    const { bytes } = exportForState({ mode: "metrica", relBase: 4, relDeriv: 7, relBpmBase: 120 });
    const m = parseMidi(bytes);
    for (const t of m.tracks.slice(1)) {
      const ons = t.notes.map((n) => n.tick);
      const paso = ons[1] - ons[0];
      const dur = t.offs[0].tick - ons[0];
      expect(dur).toBeGreaterThan(0);
      expect(dur).toBeLessThanOrEqual(paso);
    }
  });
});

describe("DUAL SINC — polirritmias exactas", () => {
  // el caso que el usuario verificó a mano en el DAW
  for (const [base, deriv] of [[4, 3], [4, 5], [4, 7], [3, 4], [2, 15], [8, 9]]) {
    it(`${base} contra ${deriv} cae en ticks enteros, sin redondeo`, () => {
      const spec = specForState({ mode: "metrica", relBase: base, relDeriv: deriv, relBpmBase: 90 });
      expect(spec.exact).toBe(true);
      const m = parseMidi(buildMidiFile(spec));

      const ticksA = m.tracks[1].notes.map((n) => n.tick);
      const ticksB = m.tracks[2].notes.map((n) => n.tick);
      const pasoA = steps(ticksA), pasoB = steps(ticksB);

      // un único paso constante, y entero
      expect(pasoA).toHaveLength(1);
      expect(pasoB).toHaveLength(1);
      expect(Number.isInteger(pasoA[0])).toBe(true);
      expect(Number.isInteger(pasoB[0])).toBe(true);

      // la relación entre pasos es exactamente base:deriv
      expect(pasoA[0] * base).toBe(pasoB[0] * deriv);

      // el ciclo mide `base` negras y entran `deriv` pulsos de B
      expect(pasoA[0]).toBe(m.ppq);
      expect(pasoB[0] * deriv).toBe(base * m.ppq);
    });
  }

  it("A y B sólo coinciden en el pulso 1 de cada ciclo", () => {
    const spec = specForState({ mode: "metrica", relBase: 4, relDeriv: 5, relBpmBase: 90 });
    const m = parseMidi(buildMidiFile(spec));
    const setB = new Set(m.tracks[2].notes.map((n) => n.tick));
    const juntos = m.tracks[1].notes.map((n) => n.tick).filter((t) => setB.has(t));
    const cicloTicks = 4 * m.ppq;
    expect(juntos.every((t) => t % cicloTicks === 0)).toBe(true);
    expect(juntos).toHaveLength(m.tracks[1].notes.length / 4);
  });

  it("acentúa el primer pulso de cada ciclo y sólo ese", () => {
    const spec = specForState({ mode: "metrica", relBase: 4, relDeriv: 5, relBpmBase: 90 });
    const m = parseMidi(buildMidiFile(spec));
    for (const [t, pulsos] of [[m.tracks[1], 4], [m.tracks[2], 5]]) {
      t.notes.forEach((n, i) => {
        expect(n.vel).toBe(i % pulsos === 0 ? VEL_ACCENT : VEL_NORMAL);
      });
    }
  });

  it("el nombre del archivo lleva la relación como la muestra la app y el BPM", () => {
    const { fileName } = exportForState({ mode: "metrica", relBase: 3, relDeriv: 4, relBpmBase: 90 });
    expect(fileName).toBe("dualpulse-4-3-90bpm.mid");
  });
});

describe("POLIMETRÍA", () => {
  it("los dos pulsan cada negra y los acentos vuelven a coincidir cada mcm", () => {
    const spec = specForState({ mode: "polimetria", polyBpm: 100, polyBeatsA: 4, polyBeatsB: 5 });
    const m = parseMidi(buildMidiFile(spec));
    const A = m.tracks[1].notes, B = m.tracks[2].notes;
    expect(steps(A.map((n) => n.tick))).toEqual([m.ppq]);
    expect(steps(B.map((n) => n.tick))).toEqual([m.ppq]);

    const accA = A.filter((n) => n.vel === VEL_ACCENT).map((n) => n.tick);
    const accB = B.filter((n) => n.vel === VEL_ACCENT).map((n) => n.tick);
    const juntos = accA.filter((t) => accB.includes(t));
    const mcm = lcm(4, 5);
    expect(juntos.every((t) => t % (mcm * m.ppq) === 0)).toBe(true);
    expect(juntos.length).toBeGreaterThan(0);
  });

  it("cubre al menos un ciclo completo de mcm", () => {
    const spec = specForState({ mode: "polimetria", polyBpm: 90, polyBeatsA: 3, polyBeatsB: 7 });
    const m = parseMidi(buildMidiFile(spec));
    expect(m.tracks[1].notes.length % lcm(3, 7)).toBe(0);
    expect(m.tracks[1].notes.length).toBeGreaterThanOrEqual(lcm(3, 7));
  });
});

describe("DUAL LIBRE", () => {
  it("el paso de B refleja la relación de tempos, en ticks enteros", () => {
    const spec = specForState({
      mode: "libre",
      metA: { bpm: 120, subdivision: 1 },
      metB: { bpm: 90,  subdivision: 1 },
    });
    expect(spec.exact).toBe(true);
    const m = parseMidi(buildMidiFile(spec));
    const pasoA = steps(m.tracks[1].notes.map((n) => n.tick));
    const pasoB = steps(m.tracks[2].notes.map((n) => n.tick));
    expect(pasoA).toEqual([m.ppq]);
    expect(pasoB).toHaveLength(1);
    // B a 90 contra un archivo a 120 => 120/90 = 4/3 negras por pulso
    expect(pasoB[0] * 90).toBe(120 * m.ppq);
    expect(Number.isInteger(pasoB[0])).toBe(true);
  });

  it("respeta las subdivisiones y acentúa sólo el pulso principal", () => {
    const spec = specForState({
      mode: "libre",
      metA: { bpm: 120, subdivision: 3 },  // tresillos
      metB: { bpm: 120, subdivision: 1 },
    });
    const m = parseMidi(buildMidiFile(spec));
    const A = m.tracks[1].notes;
    expect(steps(A.map((n) => n.tick))).toEqual([m.ppq / 3]);
    A.forEach((n, i) => expect(n.vel).toBe(i % 3 === 0 ? VEL_ACCENT : VEL_NORMAL));
  });

  it("tempos que no reducen bien siguen dando ticks enteros", () => {
    // el rango de BPM de la app es 1-600, así que las relaciones extremas cuentan
    for (const [a, b] of [[120, 91], [97, 133], [200, 3], [60, 400], [600, 1], [1, 600]]) {
      const spec = specForState({
        mode: "libre",
        metA: { bpm: a, subdivision: 1 },
        metB: { bpm: b, subdivision: 1 },
      });
      expect(spec.exact).toBe(true);
      const m = parseMidi(buildMidiFile(spec));
      const pasoB = steps(m.tracks[2].notes.map((n) => n.tick));
      expect(pasoB).toHaveLength(1);
      expect(Number.isInteger(pasoB[0])).toBe(true);
      expect(pasoB[0] * b).toBe(a * m.ppq);
    }
  });
});
