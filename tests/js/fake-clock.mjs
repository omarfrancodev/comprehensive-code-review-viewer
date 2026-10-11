/**
 * Reloj manual compatible con el contrato `opciones.clock` de `createPlayback`
 * (`ahora`, `programar`, `cancelar`).
 *
 * `advance(ms)` avanza el tiempo y ejecuta en orden las tareas vencidas; cada
 * tarea se ejecuta con `ahora()` igual a su instante de vencimiento, de modo
 * que una tarea que programa otra encadena tiempos exactos.
 */
export function createFakeClock(inicio = 0) {
  let ahora = inicio;
  let siguienteId = 1;
  const tareas = new Map();

  return {
    ahora: () => ahora,
    programar(fn, ms) {
      const id = siguienteId;
      siguienteId += 1;
      tareas.set(id, { fn, vence: ahora + Math.max(0, Number(ms) || 0), id });
      return id;
    },
    cancelar(id) {
      tareas.delete(id);
    },
    advance(ms) {
      const destino = ahora + ms;
      for (;;) {
        let proxima = null;
        for (const tarea of tareas.values()) {
          if (tarea.vence > destino) continue;
          if (!proxima || tarea.vence < proxima.vence || (tarea.vence === proxima.vence && tarea.id < proxima.id)) {
            proxima = tarea;
          }
        }
        if (!proxima) break;
        tareas.delete(proxima.id);
        ahora = proxima.vence;
        proxima.fn();
      }
      ahora = destino;
    },
    /** Número de tareas programadas sin ejecutar. */
    pending: () => tareas.size,
  };
}
