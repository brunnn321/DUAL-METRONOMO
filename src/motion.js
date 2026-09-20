// Fichas de movimiento y lectura del pulso desde el reloj del audio.
//
// Dos cosas viven acá, y las dos son cálculo puro para poder testearlas:
//
// 1. Las duraciones y curvas, en un solo sitio. Antes estaban inventadas de a
//    una en treinta lugares distintos, cada una con su número.
// 2. El búfer de pulsos: el scheduler anota cada pulso que agenda, y el bucle
//    de dibujo pregunta "¿dónde estoy ahora?" leyendo el MISMO reloj con el que
//    suena. Por eso la imagen no se puede despegar del sonido: no hay dos
//    relojes, hay uno.

// ── fichas ────────────────────────────────────────────────────────────────────
export const DUR = { fast: 120, base: 200, slow: 400 }; // ms

export const EASE = {
  entra:  "cubic-bezier(0.16, 1, 0.3, 1)",  // desacelera al llegar
  sale:   "cubic-bezier(0.7, 0, 0.84, 0)",  // acelera al irse
  lineal: "linear",                          // avance a ritmo constante
};

// Lo que se apaga dura menos que lo que se enciende: si no, la interfaz se
// siente pesada. El 65 % sale de la regla `exit-faster-than-enter`.
export const salida = (ms) => Math.round(ms * 0.65);

// Caída del brillo de un golpe, de 1 a 0. `t` son segundos desde el golpe.
// Enciende instantáneo a propósito — el sonido es la causa y suavizar la
// entrada haría que la imagen llegue tarde — y cae con una exponencial, que es
// como cae un golpe de verdad.
export function decay(t, vida = DUR.slow / 1000) {
  if (!(t >= 0)) return 0;
  if (t >= vida) return 0;
  const x = t / vida;
  return (1 - x) * (1 - x);
}

// ── búfer de pulsos ───────────────────────────────────────────────────────────
// Circular y de tamaño fijo: el scheduler escribe a ritmo de audio y nunca
// crece, así que no hay basura que recolectar en medio de la reproducción.
export const BUFFER = 64;

export function crearBuffer() {
  return { items: new Array(BUFFER).fill(null), n: 0 };
}

export function anotarPulso(buf, pulso) {
  buf.items[buf.n % BUFFER] = pulso;
  buf.n++;
  return buf;
}

export function limpiarBuffer(buf) {
  buf.items.fill(null);
  buf.n = 0;
  return buf;
}

/**
 * El último pulso que ya sonó en el instante `ahora`, y cuánto hace que sonó.
 *
 * Recorre el búfer entero porque son 64 posiciones: buscar linealmente 64 veces
 * por cuadro no se nota, y evita tener que mantener el búfer ordenado mientras
 * el scheduler escribe.
 *
 * @param {{items:Array, n:number}} buf
 * @param {number} ahora  ctx.currentTime
 * @returns {{ pulso:object, desde:number }|null}
 */
export function pulsoEn(buf, ahora) {
  let mejor = null;
  for (const p of buf.items) {
    if (!p || p.t > ahora) continue;
    if (!mejor || p.t > mejor.t) mejor = p;
  }
  return mejor ? { pulso: mejor, desde: ahora - mejor.t } : null;
}

/**
 * Fracción recorrida entre el pulso que sonó y el siguiente, de 0 a 1.
 * Sirve para el cabezal que avanza a ritmo constante: se interpola en vez de
 * saltar de pulso en pulso, que es lo que hacía que se viera a tirones.
 */
export function fraccionEntrePulsos(buf, ahora) {
  const act = pulsoEn(buf, ahora);
  if (!act) return 0;
  let siguiente = null;
  for (const p of buf.items) {
    if (!p || p.t <= act.pulso.t) continue;
    if (!siguiente || p.t < siguiente.t) siguiente = p;
  }
  const paso = siguiente ? siguiente.t - act.pulso.t : act.pulso.paso;
  if (!(paso > 0)) return 0;
  return Math.min(1, Math.max(0, act.desde / paso));
}

// ¿Hay que animar? Una sola pregunta, para no repetir la media query.
export const movimientoReducido = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false; // sin matchMedia (tests, entornos raros) se anima normal
  }
};
