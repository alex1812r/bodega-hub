/**
 * REP16-02 · D67(b): la parte del test de propiedad medible sin layout. Los casos que corren las historias
 * (`InvoiceReviewPanel.rep16-02.w*.stories.tsx`) cubren lo que dicen cubrir y los tramos de las historias los recorren
 * todos.
 */
import {
  CASES,
  CASES_PER_STORY,
  chunkOf,
  M_P17B_1_CASE,
  pairsOf,
  pairwise,
  permutations,
  type ReviewCase,
  STORY_CHUNKS,
} from "./InvoiceReviewPanel.rep16-02.cases";

const arrivalsOf = (reviewCase: ReviewCase) =>
  reviewCase.steps.flatMap((step) => (step.kind === "arrive" ? [`${step.arrival.source}:${step.arrival.outcome}`] : []));

/** Resultado con que llega `source` en el caso, o «never» si no llega. */
const levelOf = (reviewCase: ReviewCase, source: string) =>
  arrivalsOf(reviewCase).find((arrival) => arrival.startsWith(`${source}:`))?.split(":")[1] ?? "never";

describe("REP16-02 · casos del test de propiedad", () => {
  it("pairwise cubre todo par de niveles entre dos factores", () => {
    const levels = [["a", "b", "c"], ["x", "y"], ["1", "2", "3", "4"], ["p", "q"]];
    const rows = pairwise(levels);
    const covered = new Set(rows.flatMap(pairsOf));
    for (let left = 0; left < levels.length; left += 1) {
      for (let right = left + 1; right < levels.length; right += 1) {
        for (const leftValue of levels[left]) {
          for (const rightValue of levels[right]) {
            expect(covered.has(`${left}=${leftValue}|${right}=${rightValue}`)).toBe(true);
          }
        }
      }
    }
    // Mucho menos que el producto cartesiano (48).
    expect(rows.length).toBeLessThanOrEqual(16);
  });

  it.each([
    ["tasa3", ["supplier", "duplicates", "rate"]],
    ["estados", ["supplier", "purchase", "duplicates", "rate"]],
    ["estadosImpresa", ["supplier", "purchase", "duplicates", "rate"]],
  ] as const)("%s: todas las permutaciones de las fuentes con su resultado normal", (list, sources) => {
    const orders = new Set(
      CASES[list]
        .filter((reviewCase) => reviewCase.id.startsWith("orden"))
        .map((reviewCase) => arrivalsOf(reviewCase).map((arrival) => arrival.split(":")[0]).join(">")),
    );
    expect(orders.size).toBe(permutations(sources).length);
    for (const order of permutations(sources)) {
      expect(orders.has(order.join(">"))).toBe(true);
    }
  });

  it.each([
    ["tasa3", { duplicates: ["none", "match", "fail", "never"], rate: ["ok", "never"], supplier: ["ok", "fail", "never"] }],
    [
      "estados",
      {
        duplicates: ["none", "match", "fail", "never"],
        purchase: ["ok", "fail", "never"],
        rate: ["ok", "never"],
        supplier: ["ok", "fail", "never"],
      },
    ],
  ] as const)("%s: todo par de resultados (errores de red y «no llega nunca» incluidos)", (list, factors) => {
    const sources = Object.keys(factors) as (keyof typeof factors)[];
    const seen = new Set(
      CASES[list].flatMap((reviewCase) =>
        sources.flatMap((left, index) =>
          sources.slice(index + 1).map((right) => `${left}=${levelOf(reviewCase, left)}|${right}=${levelOf(reviewCase, right)}`),
        ),
      ),
    );
    sources.forEach((left, index) =>
      sources.slice(index + 1).forEach((right) => {
        const leftLevels: readonly string[] = factors[left];
        const rightLevels: readonly string[] = factors[right];
        leftLevels.forEach((leftLevel) =>
          rightLevels.forEach((rightLevel) => expect(seen).toContain(`${left}=${leftLevel}|${right}=${rightLevel}`)),
        );
      }),
    );
  });

  it("buscador: la tasa en cada hueco frente a cada último costo, y los candidatos que fallan", () => {
    const search = CASES.estadosBuscador;
    expect(search.every((reviewCase) => reviewCase.search)).toBe(true);
    const slots = new Set<string>();
    for (const reviewCase of search) {
      const steps = reviewCase.steps.map((step) => (step.kind === "pick" ? "pick" : step.arrival.source));
      const lastCost = levelOf(reviewCase, "lastCost");
      const rate = steps.indexOf("rate");
      const slot =
        rate < 0 ? "never" : rate < steps.indexOf("candidates") ? "antes" : steps.indexOf("lastCost") < 0 || rate < steps.indexOf("lastCost") ? "entre" : "despues";
      if (steps.includes("lastCost")) {
        // El último costo solo llega tras elegir, y elegir solo tras los candidatos.
        expect(steps.indexOf("candidates")).toBeLessThan(steps.indexOf("pick"));
        expect(steps.indexOf("pick")).toBeLessThan(steps.indexOf("lastCost"));
        slots.add(`${slot}|${lastCost}`);
      }
    }
    for (const slot of ["antes", "entre", "despues", "never"]) {
      for (const lastCost of ["deviated", "aligned", "null", "fail"]) {
        expect(slots).toContain(`${slot}|${lastCost}`);
      }
    }
    expect(search.filter((reviewCase) => arrivalsOf(reviewCase).includes("candidates:fail"))).toHaveLength(2);
  });

  it("incluye M-p17B-1: sin tasa impresa, solo llega la tasa del día", () => {
    expect(CASES.tasa3[0]).toEqual(M_P17B_1_CASE);
    expect(arrivalsOf(M_P17B_1_CASE)).toEqual(["rate:ok"]);
  });

  it.each(Object.keys(CASES) as (keyof typeof CASES)[])("%s: los tramos de las historias recorren todos los casos", (list) => {
    expect(STORY_CHUNKS[list]).toBe(Math.ceil(CASES[list].length / CASES_PER_STORY));
    const ran = Array.from({ length: STORY_CHUNKS[list] }, (_, chunk) => chunkOf(list, chunk)).flat();
    expect(ran).toEqual(CASES[list]);
    expect(new Set(CASES[list].map((reviewCase) => reviewCase.id)).size).toBe(CASES[list].length);
  });
});
