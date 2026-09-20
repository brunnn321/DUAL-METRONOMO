<p align="center">
  <img src="public/favicon.svg" width="96" alt="Dual Pulse">
</p>

<h1 align="center">Dual Pulse</h1>

<p align="center">
  Metrónomo doble para práctica rítmica avanzada — polirritmia, politempo y polimetría.<br>
  <a href="https://dualpulse.vercel.app"><strong>dualpulse.vercel.app</strong></a>
</p>

---

Dos metrónomos independientes, **A (coral)** y **B (celeste)**, con tres formas distintas de
relacionarlos entre sí. Corre en el navegador sin instalar nada, y también como aplicación de
escritorio para Windows.

El manual de uso completo está en **[MANUAL.md](MANUAL.md)**.

## Los tres modos

| Modo | Concepto | Relación |
|------|----------|----------|
| **DUAL SINC** | Polirritmia | Un ciclo compartido; A y B lo llenan con distinta cantidad de pulsos |
| **DUAL TEMPO** | Politempo | BPM completamente independientes; se muestra el punto de convergencia |
| **DUAL POLY** | Polimetría | Mismo BPM, ciclos de distinta longitud; los "1" se desfasan y reconvergen cada MCM |

Sobre cualquiera de los tres funciona la **SECUENCIA de compases**: una lista de pasos del
tipo `2×4/4 · 3×3/4 · 3×6/8` que corre en loop, con pasos apagables para practicar *gap
click* y acentos aditivos por paso.

Además: subdivisiones hasta 21 con sus propios acentos, acentos aditivos, tap tempo, práctica
progresiva con cambio de tempo continuo (sin cortes), cuenta de entrada, presets de secuencia,
visualizador circular con dos estilos, y **exportación del patrón a un archivo `.mid`** exacto
por construcción, con los cambios de compás de la secuencia incluidos.

## Cómo usarlo

**En la web** — abrir [dualpulse.vercel.app](https://dualpulse.vercel.app). No requiere
instalación y funciona en el celular.

**En Windows** — descargar el instalador desde la carpeta de entrega y ejecutarlo. La ventaja
frente a la web es que funciona sin conexión y queda como programa propio.

## Desarrollo

```bash
npm install
npm run dev              # servidor de desarrollo
npm test                 # 131 tests (vitest)
npm run electron:preview # la app de escritorio, sin empaquetar
npm run electron:build   # genera el instalador en release/
```

## Estructura

```
src/
  DualMetronome.jsx   Componente principal: UI, scheduler de audio, los tres modos
  phase.js            Matemática pura de fase y ciclos (MCM, razones, acentos, euclídeo)
  sequence.js         Secuencia de compases: pasos, ciclo, qué toca en el pulso N, presets
  midiExport.js       Escritura de Standard MIDI Files formato 1
  settings.js         Persistencia en localStorage
electron/
  main.cjs            Proceso principal de la aplicación de escritorio
build/
  icon.ico / icon.png Icono de la aplicación y del instalador
```

La lógica que se puede probar sin navegador vive en `phase.js`, `sequence.js`,
`midiExport.js` y `settings.js`, cada uno con su archivo de tests al lado.

## Detalles técnicos

- **Audio**: Web Audio API. Un solo `AudioContext` y un `setInterval` de 25 ms que programa
  los pulsos con 100 ms de anticipación, para que el navegador no genere glitches.
- **Estéreo**: A suena a la izquierda y B a la derecha. Separar las capas por posición evita
  que el oído las funda en un ritmo confuso, algo que importa en relaciones grandes.
- **Exportación MIDI**: la resolución (ticks por negra) se calcula por archivo como múltiplo
  del mínimo común múltiplo de los divisores del patrón, en vez de fijarse en el habitual 960.
  Así toda posición cae en un tick entero incluso con 7, 11, 13 o 15, sin redondeo.
- **La app no se conecta a ningún dispositivo MIDI.** Antes enviaba notas en vivo a un puerto
  virtual; se midió que el reloj del navegador introducía hasta 12 ms de variación por nota,
  así que se reemplazó por exportación de archivos, que es exacta por construcción.

## Licencia

Proyecto personal, sin licencia de distribución definida.
