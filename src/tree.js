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

// Reparte `total` hojas sobre un eje de tiempo COMPARTIDO: el pulso 0 de
// cualquier voz cae en x0, y el resto a i/n del ancho.
//
// Esto no es una decisión estética. Las dos voces se apoyan en la misma barra,
// y el pulso 1 de A y el pulso 1 de B suenan en el mismo instante: si cada una
// centrara sus hojas en su propia celda, esos dos pulsos quedarían dibujados en
// sitios distintos y el dibujo mentiría. Con este reparto, un 4 contra 5 se ve
// coincidiendo sólo en el 1 —que es exactamente lo que se oye— y se ve dónde
// las dos grillas se cruzan y dónde no.
export function leafPositions(total, x0, x1) {
  const n = Math.max(1, Math.round(total));
  const paso = (x1 - x0) / n;
  return Array.from({ length: n }, (_, i) => ({ i, x: x0 + paso * i }));
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

  // La raíz va al centro del COMPÁS, que es lo que mide la barra de tiempo: si
  // se para sobre el centro de sus hojas, el árbol se recuesta a la izquierda y
  // no coincide con la barra, porque la última hoja no llega al final —el hueco
  // que queda es la duración del último pulso, no un error.
  // La excepción es el compás de un solo pulso: ahí la raíz va sobre su única
  // hoja, o sale una diagonal cruzando la pantalla.
  const rootX = n === 1 ? leaves[0].x : (x0 + x1) / 2;
  return { leaves, groups: out, rootX };
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
// Topes elegidos para que la escala se mantenga: la hoja nunca supera 8, que
// es el pie de la razon 1,5 — hoja 8, grupo 12, raiz 18. Si la hoja creciera
// mas, el nivel de grupo dejaria de leerse como el nivel de arriba.
export const RADIO = { hoja: 8, grupo: 12, raiz: 18 };

export const leafRadius = (total, x0, x1) => {
  const paso = (x1 - x0) / Math.max(1, total);
  return Math.max(4, Math.min(RADIO.hoja, paso / 6));
};
