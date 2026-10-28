/**
 * REP16-02 · D67(b): casos del test de propiedad «ninguna llegada asíncrona mueve un control de la revisión».
 *
 * Cada caso es una secuencia de llegadas (fuente + resultado) que el arnés suelta en ese orden sobre un panel recién
 * montado con TODAS las fuentes retenidas. Una fuente que no está en la secuencia no llega nunca (subconjuntos).
 *
 * Cobertura (justificada: el producto cartesiano de órdenes × resultados son miles de montajes por ancho):
 * - Todas las permutaciones de las fuentes del panel con el resultado normal (`ok`): el orden es lo que decide qué
 *   se está mostrando cuando llega cada una (p. ej. la tasa antes o después del proveedor o de los duplicados).
 * - Cobertura exhaustiva de PARES de resultados (incluido «no llega nunca» y los errores de red de cada fuente),
 *   rotando el orden entre las permutaciones: todo par (resultado de A, resultado de B) sale en algún caso.
 * - Fase con buscador: los candidatos y el último costo solo llegan tras abrir el buscador de una fila y elegir un
 *   producto (acciones del usuario, que sí pueden mover y re-fijan la referencia). La tasa va antes de los
 *   candidatos, entre la elección y el último costo, después de todo o nunca; pares exhaustivos con el resto.
 *
 * Puro (sin DOM): lo comprueba `InvoiceReviewPanel.rep16-02.cases.test.ts` (jest).
 */

export type SourceId = "supplier" | "purchase" | "duplicates" | "rate" | "candidates" | "lastCost";

/**
 * `ok`: llega con el valor normal. `fail`: error de red (500 o promesa rechazada). `match`/`none`: duplicados con un
 * escaneo anterior o vacíos. `deviated`/`aligned`/`null`: último costo muy por debajo del de la línea, parecido, o
 * sin compras previas.
 */
export type Outcome = "ok" | "fail" | "match" | "none" | "deviated" | "aligned" | "null";

/** «No llega nunca»: la fuente queda fuera de la secuencia (para la tasa es también su error: la página no la pasa). */
export const NEVER = "never";
type Level = Outcome | typeof NEVER;

export type Arrival = { source: SourceId; outcome: Outcome };

/** `pick`: el usuario elige el primer producto de la lista del buscador (acción: re-fija la referencia). */
export type Step = { kind: "arrive"; arrival: Arrival } | { kind: "pick" };

export type ReviewCase = {
  id: string;
  /** Abre el buscador de la fila de búsqueda antes de la referencia (fase con candidatos y último costo). */
  search: boolean;
  steps: Step[];
};

export type FixtureId = "tasa3" | "estados" | "estadosImpresa";

const OUTCOMES: Record<"supplier" | "purchase" | "duplicates" | "rate", Level[]> = {
  supplier: ["ok", "fail", NEVER],
  purchase: ["ok", "fail", NEVER],
  duplicates: ["none", "match", "fail", NEVER],
  rate: ["ok", NEVER],
};

export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

function cartesian(levels: readonly (readonly string[])[]): string[][] {
  return levels.reduce<string[][]>((rows, values) => rows.flatMap((row) => values.map((value) => [...row, value])), [[]]);
}

const pairKey = (left: number, leftValue: string, right: number, rightValue: string) =>
  `${left}=${leftValue}|${right}=${rightValue}`;

export function pairsOf(row: readonly string[]): string[] {
  const keys: string[] = [];
  for (let left = 0; left < row.length; left += 1) {
    for (let right = left + 1; right < row.length; right += 1) {
      keys.push(pairKey(left, row[left], right, row[right]));
    }
  }
  return keys;
}

/** Conjunto mínimo-voraz (determinista) de filas que cubre todo par de niveles entre dos factores cualesquiera. */
export function pairwise(levels: readonly (readonly string[])[]): string[][] {
  const all = cartesian(levels);
  const uncovered = new Set(all.flatMap(pairsOf));
  const chosen: string[][] = [];
  while (uncovered.size > 0) {
    let best = all[0];
    let bestGain = -1;
    for (const row of all) {
      const gain = pairsOf(row).filter((key) => uncovered.has(key)).length;
      if (gain > bestGain) {
        best = row;
        bestGain = gain;
      }
    }
    pairsOf(best).forEach((key) => uncovered.delete(key));
    chosen.push(best);
  }
  return chosen;
}

const OUTCOME_SET: ReadonlySet<string> = new Set<Outcome>(["ok", "fail", "match", "none", "deviated", "aligned", "null"]);

function isOutcome(level: string): level is Outcome {
  return OUTCOME_SET.has(level);
}

/** Llegada de `source` con `level`, o ninguna si no llega nunca. */
function arrivals(source: SourceId, level: string): Step[] {
  return isOutcome(level) ? [{ kind: "arrive", arrival: { outcome: level, source } }] : [];
}

const arrive = (source: SourceId, outcome: Outcome): Step => ({ kind: "arrive", arrival: { outcome, source } });

const label = (steps: Step[]) =>
  steps.map((step) => (step.kind === "pick" ? "elige" : `${step.arrival.source}:${step.arrival.outcome}`)).join(">") ||
  "nada llega";

const OK: Record<string, Outcome> = { duplicates: "none", purchase: "ok", rate: "ok", supplier: "ok" };

/** Fase sin acciones: las fuentes del panel en todo orden (ok) y pares de resultados con el orden rotando. */
export function panelCases(sources: readonly (keyof typeof OUTCOMES)[]): ReviewCase[] {
  const orders = permutations(sources);
  const byOrder = orders.map((order, index) => {
    const steps = order.map((source) => arrive(source, OK[source]));
    return { id: `orden${index}:${label(steps)}`, search: false, steps };
  });
  const byOutcome = pairwise(sources.map((source) => OUTCOMES[source])).map((row, index) => {
    const order = orders[(index * 5) % orders.length];
    const steps = order.flatMap((source) => arrivals(source, row[sources.indexOf(source)]));
    return { id: `pares${index}:${label(steps)}`, search: false, steps };
  });
  return [...byOrder, ...byOutcome];
}

const RATE_SLOTS = ["antes", "entre", "despues", NEVER] as const;
const LAST_COSTS: Level[] = ["deviated", "aligned", "null", "fail"];
const OTHERS_SLOTS = ["primero", "ultimo"] as const;

/**
 * Fase con buscador: candidatos (ok) → el usuario elige → último costo; la tasa en cada hueco; proveedor y duplicados
 * (con sus errores) al principio o al final. Más los candidatos que fallan (no hay nada que elegir).
 */
export function searchCases(): ReviewCase[] {
  const rows = pairwise([RATE_SLOTS, LAST_COSTS, OUTCOMES.supplier, OUTCOMES.duplicates, OTHERS_SLOTS]);
  const fromRows = rows.map(([rateSlot, lastCost, supplier, duplicates, othersSlot], index) => {
    const others = [...arrivals("supplier", supplier), ...arrivals("duplicates", duplicates)];
    const rate = [arrive("rate", "ok")];
    const steps: Step[] = [
      ...(othersSlot === "primero" ? others : []),
      ...(rateSlot === "antes" ? rate : []),
      arrive("candidates", "ok"),
      { kind: "pick" },
      ...(rateSlot === "entre" ? rate : []),
      ...arrivals("lastCost", lastCost),
      ...(rateSlot === "despues" ? rate : []),
      ...(othersSlot === "ultimo" ? others : []),
    ];
    return { id: `buscador${index}:${label(steps)}`, search: true, steps };
  });
  const failing: ReviewCase[] = [
    { id: "buscador-falla-antes", search: true, steps: [arrive("rate", "ok"), arrive("candidates", "fail")] },
    { id: "buscador-falla-despues", search: true, steps: [arrive("candidates", "fail"), arrive("rate", "ok")] },
  ];
  return [...fromRows, ...failing];
}

/** M-p17B-1 primero: factura sin tasa impresa, solo llega la tasa del día y L1 queda desviada. */
export const M_P17B_1_CASE: ReviewCase = { id: "M-p17B-1:rate:ok", search: false, steps: [arrive("rate", "ok")] };

export const CASES: Record<FixtureId | "estadosBuscador", ReviewCase[]> = {
  tasa3: [M_P17B_1_CASE, ...panelCases(["supplier", "duplicates", "rate"])],
  estados: panelCases(["supplier", "purchase", "duplicates", "rate"]),
  estadosBuscador: searchCases(),
  estadosImpresa: panelCases(["supplier", "purchase", "duplicates", "rate"]),
};

/** Casos por historia: cada historia de Vitest tiene 15 s; con los cuatro anchos en paralelo un caso tarda < 0,7 s. */
export const CASES_PER_STORY = 10;

/** Historias por lista y ancho (las exporta el archivo de historias; el test de jest comprueba que cubren todo). */
export const STORY_CHUNKS: Record<keyof typeof CASES, number> = {
  estados: 4,
  estadosBuscador: 3,
  estadosImpresa: 4,
  tasa3: 2,
};

export function chunkOf(list: keyof typeof CASES, chunk: number): ReviewCase[] {
  return CASES[list].slice(chunk * CASES_PER_STORY, (chunk + 1) * CASES_PER_STORY);
}
