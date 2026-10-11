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

const BASE_TRAZA = Date.UTC(2026, 8, 1, 12, 0, 0);
const BASES_MIXTAS = ["observed_occurrence", "recording_fallback", "sequence_fallback"];

function instante(segundos) {
  return new Date(BASE_TRAZA + segundos * 1000).toISOString().replace(".000Z", "+00:00");
}

function hashSintetico(prefijo, indice) {
  return `${prefijo}${indice.toString(16).padStart(63, "0")}`.slice(0, 64);
}

/**
 * Respuesta de `/trace` sintética con `n` eventos, E000001… en orden de `sequence`.
 *
 * - `actors`: cuántos actores declarados se reparten cíclicamente (`agent · agente-0`…).
 * - `basis`: `"mixed"` alterna base observada / de registro / de secuencia;
 *   `"observed"` declara `occurred_at` en todos; `"none"` no declara tiempos
 *   (`sequence_fallback` sin `temporal_at`).
 * - `chain`: valor de `chain_status`.
 *
 * `temporal_order` es el del «backend»: ordena por `temporal_at` y, a igualdad,
 * por `sequence`; los eventos sin `temporal_at` quedan al final. No se deduce
 * duración ni concurrencia de él.
 */
export function trazaSintetica(n, { actors = 3, basis = "mixed", chain = "verified" } = {}) {
  const eventos = Array.from({ length: n }, (_, i) => {
    const ordinal = i + 1;
    const base = basis === "observed" ? "observed_occurrence" : basis === "none" ? "sequence_fallback" : BASES_MIXTAS[i % BASES_MIXTAS.length];
    const registrado = instante(i);
    const ocurrido = base === "observed_occurrence" ? instante(i - 1) : null;
    const temporal = base === "observed_occurrence" ? ocurrido : base === "recording_fallback" ? registrado : null;
    return {
      event_id: `E${String(ordinal).padStart(6, "0")}`,
      sequence: ordinal,
      kind: ["prepare", "discovery", "check", "report"][i % 4],
      status: ["started", "completed", "passed"][i % 3],
      summary: `Evento sintético ${ordinal}`,
      actor: actors > 0 ? { kind: "agent", name: `agente-${i % actors}`, provider_id: null } : null,
      executor: null,
      provenance: { kind: "helper", source: null },
      evidence: [],
      relations: i > 0 ? [{ relation: "follows", target: `E${String(i).padStart(6, "0")}` }] : [],
      authority: "recorded",
      occurred_at: ocurrido,
      recorded_at: registrado,
      recorder: { kind: "helper", name: "review_artifacts", provider_id: null },
      previous_sha256: i > 0 ? hashSintetico("a", i) : null,
      sha256: hashSintetico("a", ordinal),
      temporal_basis: base,
      temporal_at: temporal,
    };
  });
  const ordenados = [...eventos].sort((a, b) => {
    if (a.temporal_at === b.temporal_at) return a.sequence - b.sequence;
    if (a.temporal_at === null) return 1;
    if (b.temporal_at === null) return -1;
    return a.temporal_at < b.temporal_at ? -1 : 1;
  });
  return {
    events: eventos,
    valid_prefix_length: n,
    chain_status: chain,
    temporal_order: ordenados.map((evento) => evento.event_id),
    relations: eventos.flatMap((evento) => evento.relations.map((relacion) => ({
      event_id: evento.event_id,
      relation: relacion.relation,
      raw: relacion.target,
      target: relacion.target,
      status: "resolved",
      run_key: null,
      file_key: null,
    }))),
    diagnostics: [],
  };
}
