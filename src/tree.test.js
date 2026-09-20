import { describe, it, expect } from "vitest";
import { leafPositions, treeLayout, groupOfLeaf, activePath, leafRadius } from "./tree.js";

const span = { x0: 60, x1: 620 };

describe("leafPositions", () => {
  it("centra cada hoja en su celda, sin pegarlas al borde", () => {
    const l = leafPositions(7, 60, 620);
    expect(l).toHaveLength(7);
    expect(l[0].x).toBe(100);   // 60 + 80*0.5
    expect(l[6].x).toBe(580);   // 60 + 80*6.5
  });

  it("reparte parejo: la distancia entre hojas es siempre la misma", () => {
    const l = leafPositions(5, 0, 100);
    const d = l.slice(1).map((p, i) => +(p.x - l[i].x).toFixed(6));
    expect(new Set(d).size).toBe(1);
  });

  it("nunca devuelve una lista vacía", () => {
    expect(leafPositions(0, 0, 100)).toHaveLength(1);
    expect(leafPositions(-3, 0, 100)).toHaveLength(1);
  });
});

describe("treeLayout", () => {
  it("arma un nodo por grupo y los agota en orden", () => {
    const t = treeLayout(7, [2, 2, 3], span);
    expect(t.groups.map((g) => g.size)).toEqual([2, 2, 3]);
    expect(t.groups.map((g) => [g.from, g.to])).toEqual([[0, 1], [2, 3], [4, 6]]);
  });

  it("centra cada grupo sobre las hojas que cubre, no sobre su ancho", () => {
    const t = treeLayout(7, [2, 2, 3], span);
    // grupo 3: hojas 4,5,6 en 420, 500, 580 -> centro 500
    expect(t.groups[2].x).toBe(500);
    expect(t.rootX).toBe(340);
  });

  it("una agrupación que no suma el total se descarta y queda un solo grupo", () => {
    const t = treeLayout(7, [3, 3], span); // suma 6, no 7
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0]).toMatchObject({ from: 0, to: 6, size: 7 });
  });

  it("sin agrupación es un solo grupo que cubre todo el compás", () => {
    const t = treeLayout(5, null, span);
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0].size).toBe(5);
  });

  it("aguanta un compás de 21 sin perder hojas", () => {
    const t = treeLayout(21, [3, 3, 3, 3, 3, 3, 3], span);
    expect(t.leaves).toHaveLength(21);
    expect(t.groups).toHaveLength(7);
    expect(t.groups[6].to).toBe(20);
  });
});

describe("groupOfLeaf y activePath", () => {
  const t = treeLayout(7, [2, 2, 3], span);

  it("ubica cada pulso en su grupo", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => groupOfLeaf(t, i))).toEqual([0, 0, 1, 1, 2, 2, 2]);
  });

  it("sin pulso activo no hay camino", () => {
    expect(groupOfLeaf(t, -1)).toBe(-1);
    expect(activePath(t, -1)).toBeNull();
    expect(activePath(t, null)).toBeNull();
  });

  it("el camino une raíz, grupo y hoja", () => {
    const p = activePath(t, 4);
    expect(p).toEqual({ groupIdx: 2, rootX: 340, groupX: 500, leafX: 420 });
  });
});

describe("leafRadius", () => {
  it("adelgaza las hojas cuando el compás se llena", () => {
    expect(leafRadius(4, 60, 620)).toBeGreaterThan(leafRadius(21, 60, 620));
  });

  it("se queda dentro de un rango legible", () => {
    for (const n of [1, 2, 7, 12, 21]) {
      const r = leafRadius(n, 60, 620);
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r).toBeLessThanOrEqual(9);
    }
  });

  it("las hojas nunca se tocan: el diámetro entra en el paso", () => {
    for (const n of [2, 7, 12, 21]) {
      const paso = 560 / n;
      expect(leafRadius(n, 60, 620) * 2).toBeLessThan(paso);
    }
  });
});
