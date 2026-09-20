# Dual Pulse — Manual de usuario

Dual Pulse es una aplicación de metrónomo doble orientada a la práctica rítmica avanzada.

---

## Empezar en 30 segundos

1. Abre la aplicación. Vas a ver dos metrónomos: **A (rojo)** y **B (celeste)**.
2. Elige un modo arriba: **DUAL SINC** para polirritmias (4 contra 3, 4 contra 5...), **DUAL TEMPO** para dos tempos independientes, **DUAL POLY** para compases de distinto largo con el mismo pulso.
3. Pon el BPM y los números que quieras.
4. Presiona **Espacio** (o el botón verde) para arrancar y parar.
5. Si quieres el patrón dentro de tu programa de música, toca el botón de **exportar** (la flecha hacia abajo, arriba a la izquierda): baja un archivo `.mid` que arrastras a tu proyecto.

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

Además, el panel **PRÁCTICA** trae una **SECUENCIA** de compases que funciona sobre cualquiera de los tres modos (ver más abajo).

**Sobre los nombres.** DUAL TEMPO no es "metrónomos libres": al tener BPM independientes sin unidad compartida, es el terreno del *politempo* — el recurso de Ligeti (*Poème symphonique*, 1962, para 100 metrónomos) y de los cánones de tempo de Conlon Nancarrow. El aro de sincronización de fase de este modo (ver más abajo) muestra en vivo el "punto de convergencia" — el instante exacto en que las dos capas vuelven a coincidir — que es literalmente el recurso formal que Nancarrow inventó para sus estudios de pianola.

---

## Caso 1 — Uso más simple: un solo metrónomo

Si solo necesitas un metrónomo estándar, usa **DUAL TEMPO** y no inicies el segundo.

1. Selecciona **DUAL TEMPO** en la barra de modos.
2. En el panel A (rojo), ajusta el **BPM** con el slider, los botones ±1/±10, o **TAP TEMPO**.
3. Presiona **PLAY** en el panel A.
4. Deja el panel B sin iniciar.

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

Pon A a 120 BPM y B a 121 BPM, ambos con pulso simple. Es *It's Gonna Rain* de Steve Reich en miniatura: al principio los pulsos casi coinciden, se van separando de a poco, y el aro de fase muestra el retorno exacto a la alineación.

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
- **Se oye como textura** (7:5, 11:8 y relaciones mayores) — el oído deja de integrarlas como figura rítmica y las percibe como densidad. No es un error tuyo si no la puedes "sentir": es un límite real de la percepción rítmica.

### Ejemplo: 3 contra 2 (la polirritmia madre)

- A: 2, B: 3
- A suena cada ½ ciclo (2 pulsos), B cada ⅓ ciclo (3 pulsos)
- Es la relación más antigua documentada y la base de la hemiola: presente en la cadencia barroca, el vals vienés, y en el corazón de todo el ritmo latinoamericano (el 6/8 africano contra el 3/4 europeo).
- Frase mnemotécnica tradicional para sentirla: **"NO es tan DI-fí-cil"**.

### Ejemplo: 4 contra 3

- A: 3, B: 4
- Frase mnemotécnica tradicional: **"PASS the GOD damn BUT-ter"**.

### Cambiar de referencia

El oído tiende a agarrarse de una sola de las dos capas como "el pulso" — normalmente la más grave, la más fuerte, o la que entra primero. Con el mismo 3:2, practica sentir primero A como el tiempo y después B: es el ejercicio central para entrenar el oído en polirritmia.

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

### Polimetría oculta: el alcance de este modo

Existe una variante llamada **polimetría oculta**: una sola capa se va agrupando distinto mientras la otra sostiene un compás fijo, de modo que el oyente sigue percibiendo un único compás con algo que se desplaza encima, en lugar de dos metros compitiendo. Es el método de Meshuggah y del djent, y el de buena parte del techno construido con loops de largo coprimo.

**DUAL POLY sirve para practicarla**, con una salvedad. Poner Tiempos A en 4 y Tiempos B en 7: el "1" de B se desplaza contra el 4/4 de A y vuelve a caer junto a los 28 pulsos. Ese es exactamente el ejercicio — sostener el compás fijo mientras la otra capa corre por debajo. Para que se parezca todavía más al uso real, conviene bajar el volumen de A y marcar su "1" con el pie.

La salvedad es la unidad de medida. Este modo cuenta los ciclos en **tiempos enteros**, y el repertorio moderno suele definirlos en **semicorcheas** — una figura de 7 semicorcheas contra un compás de 16, por ejemplo. Esa relación no se puede escribir aquí. La sensación de desplazamiento se practica igual; lo que cambia es la escala temporal.

---

## Exportar a MIDI

El botón de **flecha hacia abajo** (arriba a la izquierda) baja un archivo `.mid` con el patrón que tienes configurado en ese momento. Lo arrastras a tu programa de música (Studio One, Ableton, Reaper, Logic, FL, el que uses) y queda como dos pistas listas para sonar.

**Cómo funciona:**

- El archivo sale con el **tempo que tengas puesto en la app**. Si armas un 4 contra 3 a 90 BPM, el archivo viene a 90 BPM.
- Trae **dos pistas separadas**, una para A y otra para B, en canales distintos, para que les pongas sonidos diferentes.
- **A usa la nota 36 (Do) y B la nota 48 (Do una octava más arriba).** Están a una octava exacta para que se distingan fácil.
- Los acentos salen en **tres niveles de volumen** (velocity): el primer pulso de cada ciclo con 110, los arranques de grupo de una métrica aditiva con 95, y el resto de los pulsos con 80. Si agrupaste un 8 en 3+3+2, el archivo trae acentuados el 1, el 4 y el 7 — no solo el 1.
- El nombre de cada pista dice la agrupación, para verla en el programa sin tener que contar: `A - 8 pulsos 3+3+2 (nota 36)`.
- El nombre del archivo dice qué es: `dualpulse-7-4-80bpm.mid` es un 7 contra 4 a 80 BPM.

**Por qué esto es exacto y tocar en vivo no lo era.** Un archivo `.mid` no guarda tiempos reales, guarda posiciones sobre la grilla del programa. Por eso cae perfecto, sin desfase ni variación. La app elige la resolución del archivo según los números de tu patrón: para un 4 contra 7, por ejemplo, usa una resolución divisible por 7 para que ningún pulso tenga que redondearse. Con la resolución típica de 960 que usan muchos programas, un 4 contra 7 caería en 548,57 posiciones y habría error.

**Un detalle al importar:** si tu programa tiene activada la cuantización automática al importar MIDI, desactívala. Si no, puede "corregir" los quintillos y septillos y arruinar justamente lo que hace especial al patrón. Lo mismo con la vista de partitura: puede dibujarlos raro aunque las posiciones estén bien. Mira el editor de piano roll.

**Con la secuencia encendida se exporta la secuencia**, no el modo. El archivo trae un cambio de compás real en cada paso —`4/4`, `3/4`, `6/8`, con su denominador correcto— así que el programa lo lee con la métrica que corresponde en cada tramo, no todo forzado a `x/4`. Los pasos apagados salen como compases vacíos, que es justamente lo que hay que estudiar. Es una sola pista, porque la secuencia maneja un solo metrónomo.

**Cuánto dura cada archivo:** 8 ciclos en DUAL SINC, hasta 4 vueltas completas del ciclo largo en DUAL POLY (menos si el ciclo es muy largo, como 11 contra 13), y unos 16 compases en DUAL TEMPO. Si necesitas más, lo repites en loop dentro de tu programa.

---

## Práctica

El panel **PRÁCTICA**, presente en los tres modos, tiene dos pestañas y un ajuste común.

**Cuenta de entrada** — arriba de las pestañas. Elige **NO**, **1 compás** o **2 compases**. Antes del primer pulso suena esa cantidad de compases con un timbre distinto (clave en el 1, rim en el resto), para que no se confunda con el patrón. Vale para los tres modos y también para la secuencia.

**PROGRESIVA** — sube el BPM automáticamente en pasos: BPM inicial (desde 30), BPM máximo, incremento y segundos entre pasos (desde 1 segundo). Al llegar al máximo puedes elegir que se detenga, se mantenga o vuelva a empezar.

El cambio de tempo es **continuo**: el metrónomo no se corta ni vuelve al pulso 1 en cada incremento, y el contador de compases sigue de largo. El número de BPM destella en amarillo en el instante del cambio, para que distingas si aceleró el metrónomo o aceleraste tú.

**SECUENCIA** — una lista de pasos que se repite en loop. Cada paso es *"N compases de X/Y"*: por ejemplo **2×4/4 · 3×3/4 · 3×6/8**, que es lo que suena en muchos temas con cambio de métrica.

- El **punto de la izquierda** apaga un paso. Un paso apagado **ocupa sus compases pero no suena**: eso es el *gap click*, el ejercicio de tocar sin referencia para desarrollar tiempo interno. Ejemplo: `2×4/4` sonando y `2×4/4` apagado te da dos compases con click y dos sin.
- Los puntos de la derecha muestran en qué compás del paso vas.
- **El BPM siempre se refiere a la negra.** En un compás de `x/8` el click va en la corchea, o sea al doble de velocidad que en `x/4` al mismo BPM. Lo que cambia al cambiar de compás no es la velocidad del pulso, sino cuántos pulsos entran antes del acento. Es lo que se lee en una partitura.
- **La secuencia maneja un solo metrónomo (A).** El otro sigue con el modo que tengas puesto y hace de pulso de referencia. Para medir una desviación hace falta algo estable contra qué medirla; dos capas cambiando de compás a la vez no dejan referencia.
- Cambiar de modo apaga la secuencia: el compás lo escribe uno solo.

**Acentos de cada paso.** No hay un editor por fila: se usa el editor de **ACENTOS** que ya está en el panel de BPM. Por defecto sigue al compás que está sonando. **Haz clic en una fila para fijarla**: queda resaltada, el editor dice `PASO 3` y a partir de ahí muestra y edita *ese* compás aunque esté sonando otro. Clic de nuevo en la fila para soltarla. Así puedes agrupar el 6/8 en 3+3 sin tener que atinarle justo al momento en que ese paso suena.

**Presets.** Debajo de la lista puedes guardar la secuencia con un nombre y recuperarla con un clic. El botón `✕` de cada preset lo borra. Guardar con un nombre que ya existe lo reemplaza.

Ambas pestañas siguen corriendo aunque colapses el panel o cambies de pestaña; la barra colapsada muestra el tiempo restante o la secuencia activa.

---

## Guardar configuraciones

La app **guarda automáticamente** el estado de ambos metrónomos (BPM, compás, subdivisión, sonidos, volumen, mute) y los parámetros de cada modo en el almacenamiento local del programa, bajo la clave `dualpulse-settings-v1`. Al volver a abrir la app, retoma donde quedaste. El estado guardado incluye la secuencia, la cuenta de entrada y los presets de secuencia.

Lo único con guardado manual son los **presets de secuencia** (pestaña SECUENCIA): esos sí se guardan con un nombre que eliges tú.

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

Cada metrónomo elige un sonido para el tiempo fuerte y otro para el débil de forma independiente. Los volúmenes se aplican tal como los dejas en el slider — la app no aplica multiplicadores internos entre tiempos fuertes, débiles o subdivisiones.

---

## Notas técnicas

- El audio usa **Web Audio API**. No requiere plugins ni controladores adicionales.
- El scheduler corre con anticipación de 100 ms sobre un `setInterval` de 25 ms, para evitar glitches de audio.
- Cambiar de modo detiene todo y reinicia el contexto de audio para evitar superposición de sonidos entre modos.
- La exportación genera un **Standard MIDI File formato 1** con una pista de tempo más una por voz. La resolución (ticks por negra) se calcula por archivo como múltiplo del mínimo común múltiplo de los divisores del patrón, no se fija en el 960 habitual: así toda posición cae en un tick entero y no hay redondeo, ni siquiera en relaciones con 7, 11, 13 o 15.
- La app **no se conecta a ningún dispositivo MIDI**. Antes mandaba notas en vivo a un puerto virtual, pero eso dependía del reloj interno del programa y nunca podía ser exacto (se midieron hasta 12 ms de variación por nota, más el retardo de salida de audio sin compensar). Exportar un archivo elimina el problema de raíz en vez de mitigarlo.
- El paneo estéreo (A izquierda, B derecha) no es solo cosmético: separar las dos capas por posición ayuda a que el oído no las funda en un ritmo confuso, algo especialmente importante en polirritmias con relaciones grandes.
