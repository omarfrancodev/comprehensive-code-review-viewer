/**
 * Generadores de datos sintéticos para las pruebas.
 *
 * Todo es público e inventado: dominios `.invalid`, identificadores derivados
 * del índice y ninguna ruta real. Son deterministas para que las capturas y las
 * aserciones no dependan del azar.
 */

const VEREDICTOS = ["approvable", "approvable_with_reservations", "not_approvable", "insufficient_evidence"];
const PERFILES = ["standard", "extended", "focused", "deep"];
const TIPOS = ["review", "rereview", "complement"];
// [archive_state, display_state]: el servidor deriva `display_state` del cierre.
const ESTADOS = [
  ["complete", "closed"],
  ["processing", "open_activity_unknown"],
  ["closing", "result_available_closure_pending"],
  ["retaining", "open_activity_unknown"],
];

const RUN_POR_REPOSITORIO = 10;

/** Clave opaca de 32 hexadecimales derivada del índice. */
export function claveSintetica(indice) {
  return indice.toString(16).padStart(32, "0");
}

/**
 * Biblioteca sintética de `total` corridas con la forma de `summary`.
 *
 * - `sameTitle`: todas las corridas comparten alcance «pr 42» (mismo título
 *   «PR #42»); solo cambian su ID de revisión y su clave.
 * - `longUrl`: repositorio, alcance, referencia e ID largos y sin espacios.
 *
 * Las corridas se agrupan de diez en diez por repositorio, en orden; con
 * `interleaved` se alternan los repositorios fila a fila (orden por fecha).
 */
export function bibliotecaSintetica(total, { sameTitle = false, longUrl = false, interleaved = false } = {}) {
  const repositorios = Math.max(1, Math.ceil(total / RUN_POR_REPOSITORIO));
  const items = Array.from({ length: total }, (_, i) => {
    const numero = sameTitle ? 42 : i + 1;
    // `interleaved` reparte las corridas entre repositorios en orden cíclico,
    // como un servidor que ordena por fecha entre repositorios.
    const indiceRepo = interleaved ? i % repositorios : Math.floor(i / RUN_POR_REPOSITORIO);
    const repositorio = `git.ejemplo.invalid/acme/repo-${String(indiceRepo).padStart(3, "0")}`;
    const largo = "segmento-sin-espacios-".repeat(14);
    const identidad = longUrl ? `https://git.ejemplo.invalid/${largo}${repositorio.split("/").at(-1)}` : repositorio;
    const [archive_state, display_state] = ESTADOS[i % ESTADOS.length];
    const dia = String((i % 28) + 1).padStart(2, "0");
    return {
      key: claveSintetica(i + 1),
      repository_label: identidad,
      repository_identity: identidad,
      scope_label: longUrl ? `branch ${largo}${numero}` : `pr ${numero}`,
      scope_reference: longUrl ? `https://git.ejemplo.invalid/${largo}/rama/${numero}` : String(numero),
      created_at: `2026-09-${dia}T12:00:00+00:00`,
      source_review_id: `CR-${String(i + 1).padStart(16, "0")}${longUrl ? largo : "aaaa"}`,
      profile: PERFILES[i % PERFILES.length],
      verdict: VEREDICTOS[i % VEREDICTOS.length],
      archive_state,
      display_state,
      phase: null,
      presentation_kind: TIPOS[i % TIPOS.length],
      last_recorded_at: `2026-09-${dia}T12:30:00+00:00`,
      last_observed_change_at: null,
      recently_observed_change: false,
      finding_counts: { confirmed: { P0: 0, P1: 0, P2: 0, P3: 0 }, totalConfirmed: 0 },
      diagnostics: [],
    };
  });
  return { items, total };
}
