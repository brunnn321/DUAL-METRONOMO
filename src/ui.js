// Fichas visuales: tipografía, espaciado y color en un solo sitio.
//
// Antes esto estaba decidido de a una, en cada lugar donde hacía falta: 16
// tamaños de fuente distintos, 15 valores de espaciado y 36 etiquetas en gris
// oscuro. Eso es lo que hace que una interfaz "no conecte" — no hay un error
// concreto en ningún lado, pero nada comparte escala con nada.
//
// El color de voz (naranja A, celeste B) NO se toca: es el lenguaje de toda la
// app, desde el icono hasta el visualizador. Lo que se corrige es la legibilidad
// y la escala.

// ── tipografía ────────────────────────────────────────────────────────────────
// Cinco tamaños, no dieciséis. Todo lo que había entre medio se redondea al más
// cercano de estos.
export const FS = {
  micro: 10,  // etiquetas de sección, en mayúsculas
  small: 12,  // texto de apoyo, valores chicos
  body:  14,  // texto normal
  lead:  22,  // cifras destacadas
  hero:  52,  // el BPM
};

// ── espaciado ─────────────────────────────────────────────────────────────────
// Múltiplos de 4. Un ritmo vertical que se repite es lo que hace que los
// paneles se vean parte de la misma cosa.
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const RAD = { sm: 6, md: 8, lg: 12, pill: 999 };

// ── color ─────────────────────────────────────────────────────────────────────
// Los tonos de texto están elegidos por contraste medido sobre el fondo de
// tarjeta (#1e2028), no a ojo:
//   muted  5,3:1   — por encima del mínimo de 4,5:1 para texto
//   faint  3,4:1   — solo para lo decorativo, nunca para algo que haya que leer
// El #555 que se usaba antes daba 2,25:1, menos de la mitad de lo exigido.
export const TX = {
  strong: "#f0f2f5",
  base:   "#c3c9d4",
  muted:  "#8b94a5",
  faint:  "#6b7484",
};

export const BG = {
  page:  "#15171c",
  card:  "#1e2028",
  inset: "#15171c",
  line:  "#2a2e38",
};

// Identidad de voz. A y B mandan en todo: visualizador, paneles y controles.
export const VOZ = {
  A: "#ff6b4a",
  B: "#4ad9ff",
  practica: "#ffd04a",
  vivo: "#4aff9a",
  parar: "#ff4a4a",
};

// ── recetas ───────────────────────────────────────────────────────────────────
// Una etiqueta de sección siempre se ve igual, en todos los paneles.
export const etiqueta = (color = TX.muted) => ({
  color,
  fontSize: FS.micro,
  fontFamily: "monospace",
  letterSpacing: 1.5,
  textTransform: "uppercase",
});

// El foco tiene que verse: sin esto no se puede usar con teclado.
export const FOCO = `2px solid ${VOZ.practica}`;

// Ancho único de contenido: el visualizador y los paneles comparten eje, si no
// parecen dos aplicaciones pegadas.
export const ANCHO = 760;

// Alto de la barra de transporte fija. El contenido reserva este espacio abajo
// para que el botón de reproducción no tape nunca un panel.
export const TRANSPORTE = 96;
