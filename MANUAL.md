# Dual Pulse — Manual de usuario

**URL:** https://dualpulse.vercel.app

Dual Pulse es una aplicación de metrónomo doble orientada a la práctica rítmica avanzada. Funciona en el navegador, no requiere instalación.

---

## Conceptos básicos

La aplicación siempre tiene **dos metrónomo activos: A (rojo) y B (azul)**. El modo elegido determina qué relación tienen entre sí.

El audio se distribuye en **estéreo**: A suena a la izquierda, B a la derecha. Si uno está silenciado o detenido, el otro centra automáticamente.

---

## Modos

Hay tres modos seleccionables en la barra superior:

| Modo | Concepto |
|------|----------|
| **DUAL SINC** | Polirritmia — ciclos iguales, diferente número de pulsos |
| **DUAL LIBRE** | Dos metrónomo completamente independientes |
| **POLIMETRÍA** | Mismo BPM, ciclos de distinta longitud |

---

## Caso 1 — Uso más simple: un solo metrónomo

Si solo necesitás un metrónomo estándar, usá **DUAL LIBRE** y no inicies el segundo.

1. Seleccioná **DUAL LIBRE** en la barra de modos.
2. En el panel A (rojo), ajustá el **BPM** con el slider o usando **TAP** (golpeá el botón al ritmo deseado).
3. Presioná **PLAY** en el panel A.
4. Dejá el panel B sin iniciar.

El metrónomo A sonará centrado (ya que B está inactivo).

---

## Caso 2 — DUAL LIBRE: dos metrónomo independientes

Cada panel tiene control total e independiente.

### Controles disponibles en cada panel:

**BPM** — slider de tempo. Rango aproximado: 30–300 BPM.

**TAP** — detecta el tempo desde golpes manuales. Golpeá al ritmo y el BPM se ajusta automáticamente.

**TIEMPO** — modifica el tempo sin reiniciar:
- `½` → mitad de velocidad
- `×1` → velocidad normal
- `×2` → doble de velocidad

**FIGURAS** — subdivide cada pulso:
- `PULSO` → un sonido por tiempo (sin subdivisión)
- `CORCHEAS` → 2 por tiempo
- `TRESILLO` → 3 por tiempo
- `SEMICORCHEA` → 4 por tiempo
- `QUINTILLO` → 5 por tiempo
- `SEISILLO`, `SIETESILLO`, `NUEVESILLO`, `ONCESILLO`, `TRECESILLO` → subdivisiones más complejas

**TIEMPO (compás)** — selector de firma de tiempo: 2/4, 3/4, 4/4, 5/4, 6/8, 7/8, etc.

**Sonido** — selector del timbre: CLICK, BEEP, WOOD, CLAVE, RIM, HAT.

**Volumen** — slider individual por metrónomo.

**PLAY / STOP** — inicia o detiene ese metrónomo de forma independiente.

### Ejemplo práctico:
Practicar 4/4 en una mano y 3/4 en la otra:
1. Panel A: compás 4/4, BPM 80 → PLAY
2. Panel B: compás 3/4, mismo BPM → PLAY
3. Los dos corren independientemente; coinciden cada 12 tiempos.

---

## Caso 3 — DUAL SINC: polirritmia

Los dos metrónomo **siempre duran lo mismo**. Se elige cuántos pulsos caben en ese ciclo compartido para cada uno.

### Parámetros:

**BPM BASE** — el tempo de referencia del ciclo completo.

**BASE** (valores 2–8) — cuántos pulsos tiene A en cada ciclo.

**DERIVADO** (valores 2–15) — cuántos pulsos tiene B en el mismo ciclo.

El BPM de B se calcula automáticamente: `BPM_B = BPM_base × DERIVADO / BASE`.

**Controles de volumen y sonido** — sliders y selectores de timbre para A y B de forma independiente.

**INICIAR / DETENER** — el botón único `DualSwitch` arranca y para ambos al mismo tiempo, garantizando que estén siempre sincronizados.

### Ejemplo: 3 contra 2 (tresillo clásico)
- BASE: 2, DERIVADO: 3
- A suena cada ½ ciclo (2 pulsos), B cada ⅓ ciclo (3 pulsos)
- Resultado: el patrón clásico 3:2

### Relaciones nombradas

La app reconoce automáticamente relaciones conocidas y muestra su nombre:

| Relación | Nombre |
|----------|--------|
| 3:2 / 2:3 | Tresillo |
| 4:3 / 3:4 | 4 contra 3 |
| 5:4 / 4:5 | Quintillo |
| 7:4 / 4:7 | Septillo |
| 9:8 / 8:9 | Nonillo |
| 15:8 / 8:15 | Quindecillo |

---

## Caso 4 — POLIMETRÍA: mismo BPM, ciclos distintos

Ambos comparten el **mismo BPM** pero cada uno tiene una cantidad diferente de tiempos por ciclo. Los tiempos-1 (el "uno" de cada compás) se desfasan y vuelven a coincidir cada cierto número de pulsos.

### Parámetros:

**BPM** — slider compartido para ambos metrónomo.

**Tiempos A** — cuántos tiempos tiene el ciclo de A (2–9).

**Tiempos B** — cuántos tiempos tiene el ciclo de B (2–9).

**MCM** — la app calcula y muestra el Mínimo Común Múltiplo: cada cuántos pulsos los dos "unos" vuelven a coincidir.

### Ejemplo: 4 sobre 3
- Tiempos A: 4, Tiempos B: 3
- MCM: 12 → cada 12 pulsos los dos "uno" coinciden
- Ambos suenan al mismo BPM pero en ciclos de distinta longitud

### Diferencia con DUAL SINC

| | DUAL SINC | POLIMETRÍA |
|--|-----------|------------|
| Ciclo total | Igual para A y B | Diferente para A y B |
| BPM | A y B tienen BPM distintos | A y B tienen el mismo BPM |
| Énfasis rítmico | Pulsos que "caben" en el mismo tiempo | Compases de distinto largo corriendo en paralelo |

---

## Práctica progresiva

Los tres modos incluyen el panel **PRÁCTICA PROGRESIVA**. Permite definir una secuencia de BPM que sube gradualmente durante la sesión.

- Definí un BPM inicial, un BPM final y el número de pasos.
- La app avanza automáticamente al siguiente BPM después de cada intervalo configurado.

---

## Guardar y cargar configuraciones

En DUAL LIBRE cada panel tiene botones de **guardar** (ícono de disco) y **eliminar** para persistir configuraciones de BPM, figuras, compás y sonido entre sesiones.

Las configuraciones se guardan en el almacenamiento local del navegador (`localStorage`) bajo la clave `dual-metronomo-v3`.

---

## Visualizador

El visualizador circular central muestra los dos anillos (A en rojo, B en azul) pulsando al ritmo. En DUAL SINC la animación refleja la relación polirrítmica entre ambos ciclos.

---

## Sonidos disponibles

| Clave | Descripción |
|-------|-------------|
| CLICK | Oscilador cuadrado, 900 Hz — el más percusivo y definido |
| BEEP | Sinusoidal suave, 660 Hz |
| WOOD | Sinusoidal grave, 280 Hz — simula golpe de madera |
| CLAVE | Sinusoidal aguda, 1500 Hz — simula clave cubana |
| RIM | Triangular, 420 Hz — simula rim shot |
| HAT | Ruido blanco filtrado paso-alto — simula hi-hat |

---

## Notas técnicas

- El audio usa **Web Audio API** nativa del navegador. No requiere plugins.
- El scheduler corre con anticipación de 100 ms para evitar glitches de audio.
- Cambiar de modo detiene todo y reinicia el contexto de audio para evitar superposición de sonidos entre modos.
- TIEMPO (½ / ×1 / ×2) en DUAL LIBRE no reinicia el scheduler; el nuevo BPM se absorbe en el siguiente tick.
