# Dual Pulse — Manual de usuario

**URL:** https://dualpulse.vercel.app

Dual Pulse es una aplicación de metrónomo doble orientada a la práctica rítmica avanzada. Funciona en el navegador, no requiere instalación.

---

## Empezar en 30 segundos

1. Abrí la app. Vas a ver dos metrónomos: **A (rojo)** y **B (celeste)**.
2. Elegí un modo arriba: **DUAL SINC** para polirritmias (4 contra 3, 4 contra 5...), **DUAL TEMPO** para dos tempos independientes, **DUAL POLY** para compases de distinto largo con el mismo pulso.
3. Poné el BPM y los números que quieras.
4. Apretá **Espacio** (o el botón verde) para arrancar y parar.
5. Si querés el patrón dentro de tu programa de música, tocá el botón de **exportar** (la flecha hacia abajo, arriba a la izquierda): baja un archivo `.mid` que arrastrás a tu proyecto.

Eso es todo. El resto del manual explica cada cosa en detalle.

### Los botones de arriba a la izquierda

| Botón | Qué hace |
|-------|----------|
| Círculo/polígono amarillo | Cambia el estilo del visualizador |
| Flecha hacia abajo | Exporta el patrón actual a un archivo `.mid` |

### Los botones de arriba a la derecha

| Botón | Qué hace |
|-------|----------|
| Pantalla completa | Agranda el visualizador |
| Bombilla | Destello de pantalla en cada tiempo |

---

## Conceptos básicos

La aplicación siempre tiene **dos metrónomos activos: A (rojo) y B (celeste)**. El modo elegido determina qué relación tienen entre sí.

El audio se distribuye en **estéreo**: A suena a la izquierda, B a la derecha. Si uno está silenciado o detenido, el otro centra automáticamente.

Atajo global: **Espacio** o **Enter** inician/detienen ambos metrónomos a la vez (se ignora si el foco está en un campo de texto).

---

## Modos

Hay tres modos seleccionables en la barra superior:

| Modo | Concepto musical |
|------|----------|
| **DUAL SINC** | Polirritmia — un solo ciclo compartido, A y B caben con distinto número de pulsos |
| **DUAL TEMPO** | Politempo — dos metrónomos con BPM completamente independientes |
| **DUAL POLY** | Polimetría con pulso común — mismo BPM, cada uno agrupa en un ciclo de distinta longitud |

**Sobre los nombres.** DUAL TEMPO no es "metrónomos libres": al tener BPM independientes sin unidad compartida, es el terreno del *politempo* — el recurso de Ligeti (*Poème symphonique*, 1962, para 100 metrónomos) y de los cánones de tempo de Conlon Nancarrow. El aro de sincronización de fase de este modo (ver más abajo) muestra en vivo el "punto de convergencia" — el instante exacto en que las dos capas vuelven a coincidir — que es literalmente el recurso formal que Nancarrow inventó para sus estudios de pianola.

---

## Caso 1 — Uso más simple: un solo metrónomo

Si solo necesitás un metrónomo estándar, usá **DUAL TEMPO** y no inicies el segundo.

1. Seleccioná **DUAL TEMPO** en la barra de modos.
2. En el panel A (rojo), ajustá el **BPM** con el slider, los botones ±1/±10, o **TAP TEMPO**.
3. Presioná **PLAY** en el panel A.
4. Dejá el panel B sin iniciar.

El metrónomo A sonará centrado (ya que B está inactivo).

---

## Caso 2 — DUAL TEMPO: dos metrónomos independientes (politempo)

Cada panel tiene control total e independiente. Rango de BPM: **1–600**.

### Controles disponibles en cada panel:

**BPM** — slider de tempo, botones ±1/±10, o **TAP TEMPO** (promedia hasta 6 golpes).

**FIGURAS** — subdivide cada pulso. Valores disponibles: 1 (pulso simple), 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15 subdivisiones por tiempo.

**BAR** — contador de compás visible por panel.

**Sonido** — selector separado de timbre para el tiempo **FUERTE** y el **DÉBIL**: CLICK, BEEP, WOOD, CLAVE, RIM, HAT.

**Volumen** — slider individual por metrónomo, y mute.

**PLAY / STOP** — inicia o detiene ese metrónomo de forma independiente.

### El aro de sincronización de fase

Cuando los dos BPM son distintos, aparece un aro ámbar alrededor del visualizador que marca en vivo cuántos pulsos faltan para que A y B vuelvan a coincidir en fase. El punto se calcula en pulsos reales de audio, no en segundos de reloj. Tocar el punto (playhead) alterna si el conteo sigue a A o a B.

### Ejemplo práctico — el phasing de Reich

Poné A a 120 BPM y B a 121 BPM, ambos con pulso simple. Es *It's Gonna Rain* de Steve Reich en miniatura: al principio los pulsos casi coinciden, se van separando de a poco, y el aro de fase muestra el retorno exacto a la alineación.

---

## Caso 3 — DUAL SINC: polirritmia

Los dos metrónomos **siempre duran lo mismo**. Se elige cuántos pulsos caben en ese ciclo compartido para cada uno.

### Parámetros:

**BPM A** — el tempo de referencia del ciclo completo (1–600).

**A** — cuántos pulsos tiene el metrónomo A en cada ciclo. Valores: 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15.

**B** — cuántos pulsos tiene B en el mismo ciclo. Mismo rango de valores que A.

El BPM de B se calcula automáticamente: `BPM_B = BPM_A × B / A`.

**Controles de volumen y sonido** — sliders y selectores de timbre para A y B de forma independiente.

**INICIAR / DETENER** — el botón único `DualSwitch` arranca y para ambos al mismo tiempo, garantizando que estén siempre sincronizados.

### ¿Cuándo es realmente una polirritmia?

La app muestra la **relación reducida** debajo del número. Si A y B comparten un divisor común (por ejemplo 8:4), la relación se reduce (a 2:1 en ese caso) y la app avisa que es una **subdivisión, no una polirritmia**: no hay conflicto real de grillas entre las dos capas, es la misma pulsación partida en dos. Una polirritmia verdadera requiere que la relación reducida sea **coprima** — 5:4, 3:2, 7:4, etc. — porque solo ahí las dos capas tienen ataques que no coinciden salvo en el "1".

Cuando la relación es coprima, la app además marca cuán fácil es de oír:
- **Se integra como una figura** (3:2, 4:3) — el oído las funde en un solo patrón rítmico.
- **Se oyen dos capas separadas** (5:4, 7:4) — el oído distingue las dos grillas pero puede seguirlas.
- **Se oye como textura** (7:5, 11:8 y relaciones mayores) — el oído deja de integrarlas como figura rítmica y las percibe como densidad. No es un error tuyo si no la podés "sentir": es un límite real de la percepción rítmica.

### Ejemplo: 3 contra 2 (la polirritmia madre)

- A: 2, B: 3
- A suena cada ½ ciclo (2 pulsos), B cada ⅓ ciclo (3 pulsos)
- Es la relación más antigua documentada y la base de la hemiola: presente en la cadencia barroca, el vals vienés, y en el corazón de todo el ritmo latinoamericano (el 6/8 africano contra el 3/4 europeo).
- Frase mnemotécnica tradicional para sentirla: **"NO es tan DI-fí-cil"**.

### Ejemplo: 4 contra 3

- A: 3, B: 4
- Frase mnemotécnica tradicional: **"PASS the GOD damn BUT-ter"**.

### Cambiar de referencia

El oído tiende a agarrarse de una sola de las dos capas como "el pulso" — normalmente la más grave, la más fuerte, o la que entra primero. Con el mismo 3:2, practicá sentir primero A como el tiempo y después B: es el ejercicio central para entrenar el oído en polirritmia.

---

## Caso 4 — DUAL POLY: polimetría con pulso común

Ambos comparten el **mismo BPM** pero cada uno agrupa una cantidad diferente de tiempos por ciclo. Los tiempos-1 (el "uno" de cada compás) se desfasan y vuelven a coincidir cada cierto número de pulsos.

### Parámetros:

**BPM** — slider compartido para ambos metrónomos (1–600).

**Tiempos A** — cuántos tiempos tiene el ciclo de A. Valores: 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15.

**Tiempos B** — cuántos tiempos tiene el ciclo de B. Mismo rango.

**MCM / COINCIDENCIA** — la app calcula el Mínimo Común Múltiplo de Tiempos A y B, y muestra en vivo cuántos pulsos faltan para que los dos "uno" vuelvan a coincidir.

### Ejemplo: 4 sobre 3

- Tiempos A: 4, Tiempos B: 3
- MCM: 12 → cada 12 pulsos los dos "uno" coinciden
- Ambos suenan al mismo BPM pero en ciclos de distinta longitud.

### Ejemplo: 5 sobre 7 (King Crimson, *Discipline*)

- Tiempos A: 5, Tiempos B: 7
- MCM: 35 — no hay coincidencias internas porque 5 y 7 son coprimos: las capas no vuelven a juntarse hasta el final del ciclo completo. Es uno de los ejemplos más limpios de polimetría del repertorio moderno.

### Diferencia con DUAL SINC

| | DUAL SINC (polirritmia) | DUAL POLY (polimetría) |
|--|-----------|------------|
| Ciclo total | Igual para A y B | Distinto para A y B |
| BPM | A y B tienen BPM distintos | A y B comparten el mismo BPM |
| Qué varía | Cuántos pulsos caben en el mismo tiempo | El largo del compás de cada uno |
| El "1" | Cae siempre junto | Se desfasa y reconverge cada MCM pulsos |

### Lo que este modo no cubre todavía

DUAL POLY implementa la polimetría "de manual": dos compases con pulso común. No cubre la **polimetría oculta** — una sola capa agrupándose distinto mientras la otra sostiene un compás fijo — que es el método real que usan Meshuggah, el djent, y buena parte del techno con loops de largo coprimo. Es una posible ampliación futura de la app (ver notas de desarrollo internas).

---

## Exportar a MIDI

El botón de **flecha hacia abajo** (arriba a la izquierda) baja un archivo `.mid` con el patrón que tenés configurado en ese momento. Lo arrastrás a tu programa de música (Studio One, Ableton, Reaper, Logic, FL, el que uses) y queda como dos pistas listas para sonar.

**Cómo funciona:**

- El archivo sale con el **tempo que tengas puesto en la app**. Si armás un 4 contra 3 a 90 BPM, el archivo viene a 90 BPM.
- Trae **dos pistas separadas**, una para A y otra para B, en canales distintos, para que les pongas sonidos diferentes.
- **A usa la nota 36 (Do) y B la nota 48 (Do una octava más arriba).** Están a una octava exacta para que se distingan fácil.
- El **primer pulso de cada ciclo suena más fuerte** (velocity 110 contra 80), así se ve y se escucha dónde empieza cada vuelta.
- El nombre del archivo dice qué es: `dualpulse-7-4-80bpm.mid` es un 7 contra 4 a 80 BPM.

**Por qué esto es exacto y tocar en vivo no lo era.** Un archivo `.mid` no guarda tiempos reales, guarda posiciones sobre la grilla del programa. Por eso cae perfecto, sin desfase ni variación. La app elige la resolución del archivo según los números de tu patrón: para un 4 contra 7, por ejemplo, usa una resolución divisible por 7 para que ningún pulso tenga que redondearse. Con la resolución típica de 960 que usan muchos programas, un 4 contra 7 caería en 548,57 posiciones y habría error.

**Un detalle al importar:** si tu programa tiene activada la cuantización automática al importar MIDI, desactivala. Si no, puede "corregir" los quintillos y septillos y arruinar justamente lo que hace especial al patrón. Lo mismo con la vista de partitura: puede dibujarlos raro aunque las posiciones estén bien. Mirá el editor de piano roll.

**Cuánto dura cada archivo:** 8 ciclos en DUAL SINC, hasta 4 vueltas completas del ciclo largo en DUAL POLY (menos si el ciclo es muy largo, como 11 contra 13), y unos 16 compases en DUAL TEMPO. Si necesitás más, lo repetís en loop dentro de tu programa.

---

## Práctica

El panel **PRÁCTICA**, presente en los tres modos, tiene dos pestañas:

**TIMER** — cuenta regresiva tipo pomodoro. Presets de 5 a 60 minutos, o un valor personalizado de 1 a 180 minutos. Al llegar a 0 suena una alarma de tres tonos y detiene ambos metrónomos automáticamente.

**PROGRESIVA** — sube el BPM automáticamente en pasos, a intervalos configurables (BPM inicial, BPM máximo, incremento, y segundos entre pasos). Al llegar al máximo podés elegir que se detenga, se mantenga, o vuelva a empezar.

Ambas pestañas siguen contando aunque colapses el panel o cambies de pestaña; la barra colapsada muestra el tiempo restante.

---

## Guardar configuraciones

La app **guarda automáticamente** el estado de ambos metrónomos (BPM, compás, subdivisión, sonidos, volumen, mute) y los parámetros de cada modo en el almacenamiento local del navegador (`localStorage`), bajo la clave `dualpulse-settings-v1`. No hay botones de guardar/cargar manuales ni presets nombrados: al volver a abrir la app, retoma donde quedaste.

El estado en vivo (si está sonando, en qué tiempo va) nunca se guarda — siempre arranca detenida.

---

## Visualizador

El visualizador circular central se puede alternar entre dos estilos con el botón de arriba a la izquierda:

- **Aros** — dos arcos concéntricos (A por fuera, B por dentro) que se llenan al ritmo de cada ciclo, con una onda expansiva en cada "1".
- **Collar** (*necklace*, por defecto) — un polígono regular de N vértices por metrónomo, con el vértice del "1" marcado. Es la forma estándar de representar ritmos geométricamente en el análisis rítmico comparado (la *necklace notation* de Godfried Toussaint).

En DUAL TEMPO y DUAL POLY aparece además el **aro de sincronización de fase**: un arco ámbar externo que muestra la fracción del ciclo de re-alineación ya recorrida, con destello blanco en el instante exacto de la sincronía.

Otros controles del visualizador:
- **Modo foco** (ícono de pantalla completa) — agranda el visualizador a pantalla completa.
- **Destello de pantalla** (ícono de bombilla) — reemplaza el visualizador por un flash de color a pantalla partida en cada tiempo, con el número de tiempo en grande. Foco y destello son mutuamente excluyentes, y ambos requieren que algo esté sonando.

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

Cada metrónomo elige un sonido para el tiempo fuerte y otro para el débil de forma independiente. Los volúmenes se aplican tal como los dejás en el slider — la app no aplica multiplicadores internos entre tiempos fuertes, débiles o subdivisiones.

---

## Notas técnicas

- El audio usa **Web Audio API** nativa del navegador. No requiere plugins.
- El scheduler corre con anticipación de 100 ms sobre un `setInterval` de 25 ms, para evitar glitches de audio.
- Cambiar de modo detiene todo y reinicia el contexto de audio para evitar superposición de sonidos entre modos.
- La exportación genera un **Standard MIDI File formato 1** con una pista de tempo más una por voz. La resolución (ticks por negra) se calcula por archivo como múltiplo del mínimo común múltiplo de los divisores del patrón, no se fija en el 960 habitual: así toda posición cae en un tick entero y no hay redondeo, ni siquiera en relaciones con 7, 11, 13 o 15.
- La app **no se conecta a ningún dispositivo MIDI**. Antes mandaba notas en vivo a un puerto virtual, pero eso dependía del reloj del navegador y nunca podía ser exacto (se midieron hasta 12 ms de variación por nota, más el retardo de salida de audio sin compensar). Exportar un archivo elimina el problema de raíz en vez de mitigarlo.
- El paneo estéreo (A izquierda, B derecha) no es solo cosmético: separar las dos capas por posición ayuda a que el oído no las funda en un ritmo confuso, algo especialmente importante en polirritmias con relaciones grandes.
