// Geometría del visualizador de árbol.
//
// Un compás se dibuja como tres niveles: la raíz con el compás entero, un nodo
// por cada grupo de la métrica aditiva, y una hoja por pulso. Las hojas se
// apoyan sobre una barra de tiempo horizontal, así que dos voces con métricas
// distintas quedan comparables: se ve dónde coinciden y dónde no.
//
// Todo acá es cálculo puro, sin React y sin SVG, para poder testearlo igual que
// phase.js y sequence.js. El componente sólo traduce estos números a trazos.

import { effectiveGroups } from "./phase.js";

// Reparte `total` hojas entre x0 y x1, centradas en su propia celda: con 7
// hojas entre 60 y 620 la primera queda en 100 y la última en 580, nunca
// pegadas al borde.
export function leafPositions(total, x0, x1) {
  const n = Math.max(1, Math.round(total));
  const paso = (x1 - x0) / n;
  return Array.from({ length: n }, (_, i) => ({ i, x: x0 + paso * (i + 0.5) }));
}

/**
 * Nodos del árbol de un compás.
 *
 * @param {number} total   pulsos del compás
 * @param {number[]|null} groups agrupación aditiva (3+3+2); si no suma `total`,
 *   effectiveGroups la descarta y queda un solo grupo — mismo criterio que usa
 *   el scheduler para los acentos
 * @param {{x0:number, x1:number}} span ancho disponible
 * @returns {{ leaves:{i:number,x:number}[], groups:{from:number,to:number,size:number,x:number}[], rootX:number }}
 *   `from` y `to` son índices de hoja inclusivos; `x` de cada grupo es el centro
 *   de las hojas que cubre, no el centro de su ancho, para que la rama caiga
 *   donde están realmente los pulsos.
 */
export function treeLayout(total, groups, { x0, x1 }) {
  const n = Math.max(1, Math.round(total));
  const leaves = leafPositions(n, x0, x1);
  const sizes = effectiveGroups(groups, n);

  const out = [];
  let from = 0;
  for (const size of sizes) {
    if (size <= 0) continue;
    const to = Math.min(n - 1, from + size - 1);
    out.push({
      from, to, size,
      x: (leaves[from].x + leaves[to].x) / 2,
    });
    from = to + 1;
    if (from >= n) break;
  }

  return { leaves, groups: out, rootX: (x0 + x1) / 2 };
}

// A qué grupo pertenece un pulso. Devuelve -1 si el pulso cae fuera del compás
// (por ejemplo cuando todavía no empezó a sonar y `beat` vale -1).
export function groupOfLeaf(layout, leafIdx) {
  if (leafIdx == null || leafIdx < 0) return -1;
  return layout.groups.findIndex((g) => leafIdx >= g.from && leafIdx <= g.to);
}

/**
 * El camino de la raíz a la hoja que suena: los tres puntos que hay que unir
 * para marcarlo en verde. Devuelve null si no hay pulso activo, así el
 * componente no tiene que defenderse.
 */
export function activePath(layout, leafIdx) {
  const g = groupOfLeaf(layout, leafIdx);
  if (g < 0) return null;
  return {
    groupIdx: g,
    rootX: layout.rootX,
    groupX: layout.groups[g].x,
    leafX: layout.leaves[leafIdx].x,
  };
}

// Radio de las hojas según cuántas entren: con pocas se ven gordas, con 21
// tienen que adelgazar para no tocarse. El paso entre hojas manda, y el divisor
// está elegido para que el tope de 9 px se suelte recién pasando los 12 pulsos
// — antes de eso las hojas sobran de espacio y conviene que se vean grandes.
export const leafRadius = (total, x0, x1) => {
  const paso = (x1 - x0) / Math.max(1, total);
  return Math.max(3, Math.min(9, paso / 5));
};
