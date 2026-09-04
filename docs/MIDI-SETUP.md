# MIDI — cómo conectar Dual Pulse con un DAW

Guía para reconectar todo si se cambia de DAW, de PC, o se reinstala algo.

## Qué hace cada cosa

- **Ícono "MIDI"**: la app manda una nota MIDI por cada clic (A y B en canales/notas
  configurables) — sirve para grabar el patrón de pulso como MIDI real en el DAW.
- **Ícono de reloj**: el DAW es el maestro. Le manda a la app el tempo (reloj MIDI,
  24 pulsos por negra) y el play/stop (Start/Stop MIDI) — la app sigue el tempo y
  arranca/para sola cuando el DAW lo hace.

Ninguna de las dos cosas funciona sin un puerto MIDI virtual de por medio (ver abajo).
Solo funciona en Chrome/Edge (Web MIDI API) — no en Safari/Firefox.

## Paso 1 — loopMIDI (una sola vez por PC)

1. Instalar loopMIDI: https://www.tobias-erichsen.de/software/loopmidi.html
2. Abrirlo y crear un puerto con el botón `+`. Nombre recomendado: **"Dual pulse"**
   (la app busca puertos que contengan "dual pulse" o "loopmidi" en el nombre;
   si no encuentra ninguno, usa el primero disponible).
3. loopMIDI recuerda el puerto creado entre reinicios — este paso no se repite.

**En el .exe de escritorio** (no en la web): Dual Pulse detecta si loopMIDI no está
corriendo y lo abre solo al iniciar la app. Igual hace falta haberlo instalado y
haber creado el puerto una vez a mano — eso ninguna app externa lo puede automatizar
(la licencia del driver que usa loopMIDI no permite que otro programa cree el
puerto por su cuenta).

## Paso 2 — Dual Pulse

- Ícono MIDI (notas) y/o ícono de reloj (arriba a la izquierda): activarlos.
  Si no encuentra puerto, muestra un asistente con estos mismos pasos.
- El estado de estos íconos **no se guarda** entre sesiones — hay que
  reactivarlos cada vez que se abre la app.

## Paso 3 — el DAW

### Genérico (cualquier DAW)

- Como **salida** MIDI del DAW (para que reciba el reloj/notas de la app): elegir
  el puerto "Dual pulse" como entrada MIDI del DAW.
- Como **entrada** MIDI del DAW (para que la app siga el tempo del DAW): el DAW
  tiene que **enviar** reloj MIDI (MIDI Clock) al puerto "Dual pulse", no
  Timecode (MTC) — son protocolos distintos y la app solo entiende Clock.

### PreSonus Studio One (probado y confirmado funcionando)

Un checkbox de "Enviar Reloj MIDI" en Dispositivos Externos **no alcanza** —
Studio One solo transmite el reloj a través de una pista de instrumento
ruteada al dispositivo. Pasos:

1. `Studio Pro > Opciones > Dispositivos externos > Agregar...`
2. Elegir la categoría **"Nuevo instrumento"** (no "Nuevo teclado" — ese tipo
   no aparece después como instrumento asignable a una pista).
3. Nombre: lo que sea (ej. "DUAL PULSE INSTR"). "Enviar a": el puerto Dual pulse.
4. Tildar **"Enviar Reloj MIDI"** y **"Usar inicio de reloj MIDI"**.
5. `Ver > Explorador (F5) > Instrumentos > Instrumentos externos` — ahí va a
   aparecer el dispositivo recién creado.
6. Arrastrarlo a una pista vacía (o `Pista > Agregar pista de instrumento` y
   asignarlo desde ahí) — esto crea una pista de instrumento ruteada.
7. Dar play. El reloj debería llegar y Dual Pulse tomar el tempo solo.

**Este ruteo queda guardado en el proyecto, no es global.** Un proyecto nuevo no
lo va a tener — hay que repetir el paso 6 (arrastrar el instrumento ya creado
a una pista nueva) o guardar este proyecto como plantilla por defecto en
Studio One para que los proyectos nuevos ya arranquen con la pista lista.

**Cuidado con duplicar el reloj**: si además del dispositivo de la pista de
instrumento queda *otro* dispositivo con "Enviar Reloj MIDI" tildado apuntando
al mismo puerto, Dual Pulse va a leer un tempo aproximadamente el doble del
real (dos relojes intercalados). Si el BPM detectado se ve raro (el doble o
cerca), revisar que solo UN dispositivo esté mandando reloj a ese puerto.

## Troubleshooting rápido

| Síntoma | Causa probable |
|---|---|
| Modal "Falta un puerto MIDI" | loopMIDI cerrado o sin puerto creado |
| Ícono de reloj prende pero nada sincroniza | el DAW no está mandando reloj de verdad al puerto (revisar ruteo, no solo el checkbox) |
| BPM detectado ≈ el doble del real | dos dispositivos mandando reloj al mismo puerto |
| Funciona en el .exe pero no en la web | normal — loopMIDI hay que abrirlo a mano en la versión web, no se auto-lanza |
