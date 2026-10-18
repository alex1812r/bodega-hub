import { normalizeAlias } from "@bodega/core/invoice";

import type { EntityFetcherParams, ProductEntityOption } from "@/shared/components/EntityAutocomplete";

/** Por debajo de esto el texto leído no basta y se busca por sus palabras (SCN-08). */
export const READ_TEXT_MIN_RESULTS = 3;
/** Palabras que se consultan por separado, las más largas primero. */
const MAX_TOKENS = 5;
/** Parecido mínimo entre dos palabras para contarlas como la misma ("sabor" ~ "sabores"). */
const TOKEN_MATCH_MIN = 0.5;

/** Conectores, unidades y empaques: no distinguen un producto de otro. */
const GENERIC_WORDS = new Set([
  "con", "del", "las", "los", "para", "por", "sin", "una", "uno",
  "und", "unds", "uds", "unid", "unidad", "unidades", "pza", "pzas",
  "lts", "ltr", "ltrs", "litro", "litros", "kgs", "kilo", "kilos", "grs", "grm", "gramos", "mls",
  "bulto", "bultos", "caja", "cajas", "display", "docena", "paq", "paquete", "paquetes", "pqt", "fardo",
]);

/** Palabras que identifican el producto: solo letras, ≥ 3, sin genéricas. */
export function significantTokens(text: string): string[] {
  const words = normalizeAlias(text)
    .split(" ")
    .filter((word) => /^\p{L}{3,}$/u.test(word) && !GENERIC_WORDS.has(word));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, MAX_TOKENS);
}

function bigrams(word: string): string[] {
  if (word.length < 2) {
    return [word];
  }
  return Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2));
}

/** Coeficiente de Dice sobre bigramas (0..1). */
function dice(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  const left = bigrams(a);
  const right = bigrams(b);
  const pool = [...right];
  let shared = 0;
  for (const gram of left) {
    const index = pool.indexOf(gram);
    if (index >= 0) {
      shared += 1;
      pool.splice(index, 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

/**
 * Busca con el texto leído y, si trae menos de `READ_TEXT_MIN_RESULTS`, también
 * con cada palabra significativa; une y ordena por parecido con lo leído. Cada
 * palabra pesa según lo rara que es (1 / resultados que trajo), así "glup" pesa
 * más que "refresco".
 */
export async function searchByReadText(
  fetcher: (params: EntityFetcherParams<"product">) => Promise<ProductEntityOption[]>,
  params: EntityFetcherParams<"product">,
): Promise<ProductEntityOption[]> {
  const found = await fetcher(params);
  const tokens = significantTokens(params.query);
  if (found.length >= READ_TEXT_MIN_RESULTS || tokens.length === 0) {
    return found;
  }

  const perToken = await Promise.all(tokens.map((token) => fetcher({ ...params, exact: false, query: token })));
  const weights = new Map(tokens.map((token, index) => [token, 1 / Math.max(1, perToken[index].length)]));

  const byId = new Map<string, ProductEntityOption>();
  for (const option of [...found, ...perToken.flat()]) {
    if (!byId.has(option.id)) {
      byId.set(option.id, option);
    }
  }

  const read = normalizeAlias(params.query);
  const scored = [...byId.values()].map((option) => {
    const words = normalizeAlias(option.label).split(" ");
    let score = 0;
    for (const token of tokens) {
      const best = Math.max(0, ...words.map((word) => dice(token, word)));
      if (best >= TOKEN_MATCH_MIN) {
        score += best * (weights.get(token) ?? 0);
      }
    }
    return { option, score, whole: dice(read, normalizeAlias(option.label)) };
  });

  const literal = new Set(found.map((option) => option.id));
  return scored
    .sort(
      (a, b) =>
        Number(literal.has(b.option.id)) - Number(literal.has(a.option.id)) ||
        b.score - a.score ||
        b.whole - a.whole ||
        a.option.label.localeCompare(b.option.label),
    )
    .slice(0, params.limit)
    .map(({ option }) => option);
}
