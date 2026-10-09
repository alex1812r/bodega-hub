import { apiFetch, ClientApiError } from "@/shared/api/apiFetch";

/**
 * Opciones de react-query comunes a los hooks de impact (`useSaleImpact`, …).
 *
 * El efecto se recalcula cada vez que se abre el modal: sin caché entre
 * aperturas (`gcTime: 0`), siempre rancio (`staleTime: 0`), sin reintentos (un
 * 403/404/409 no cambia por repetir) y sin refrescos en segundo plano que
 * cambien las cifras mientras el usuario las lee.
 */
export const impactQueryOptions = {
  gcTime: 0,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: false,
  staleTime: 0,
} as const;

/** Clave de consulta de un impact: `["impact", <doc>, <id>, <action>, …]`. */
export function impactQueryKey(
  document: "payments" | "purchases" | "sales",
  id: string,
  action: string,
) {
  return ["impact", document, id, action] as const;
}

/** Espera máxima de un impact: pasado esto el modal deja de «calcular» y ofrece reintentar. */
export const IMPACT_TIMEOUT_MS = 15_000;

/** Lo que ve el usuario cuando el efecto no llega, llega roto o es de otro documento. */
export const IMPACT_UNAVAILABLE_MESSAGE = "No se pudo calcular el efecto. Reintenta.";

/** El impact no llegó a tiempo o lo que llegó no sirve para mostrar el efecto. */
export class ImpactUnavailableError extends Error {
  constructor() {
    super(IMPACT_UNAVAILABLE_MESSAGE);
    this.name = "ImpactUnavailableError";
  }
}

export function isImpactRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ImpactShape = {
  /** La acción pedida: la respuesta debe ser de esa misma. */
  action: string;
  /** Listas que el modal recorre sin comprobar: deben venir, aunque sea vacías. */
  arrays: readonly string[];
  /** Id que debe traer `document.id`, cuando el documento es el pedido. */
  documentId?: string;
};

/**
 * Forma mínima de un impact (CNF-F7): veredicto, la acción pedida, la cabecera del
 * documento (el pedido, si se indica) y las listas que el modal pinta. No valida las
 * cifras: solo que el modal pueda pintar la respuesta y que sea la que se pidió.
 */
export function hasImpactShape(
  value: unknown,
  { action, arrays, documentId }: ImpactShape,
): value is Record<string, unknown> {
  if (!isImpactRecord(value) || typeof value.allowed !== "boolean" || value.action !== action) {
    return false;
  }

  const header = value.document;

  if (
    !isImpactRecord(header) ||
    typeof header.id !== "string" ||
    typeof header.number !== "string" ||
    typeof header.status !== "string" ||
    typeof header.statusAfter !== "string"
  ) {
    return false;
  }

  if (documentId !== undefined && header.id !== documentId) {
    return false;
  }

  return arrays.every((key) => Array.isArray(value[key]));
}

type FetchImpactOptions = {
  /** `true` si la respuesta tiene la forma del impact pedido (ver `hasImpactShape`). */
  isExpected: (data: unknown) => boolean;
  query: Record<string, string>;
};

/**
 * Pide un impact y solo lo devuelve si se puede mostrar. Un rechazo de la API (403, 404,
 * 409…) sale tal cual, con su mensaje. Todo lo demás —sin respuesta en
 * `IMPACT_TIMEOUT_MS`, red caída, cuerpo ilegible, respuesta vacía, sin la forma esperada
 * o de otro documento— es un `ImpactUnavailableError`: el modal muestra el error con
 * «Reintentar» y no deja confirmar.
 */
export async function fetchImpact<TImpact>(
  path: string,
  { isExpected, query }: FetchImpactOptions,
): Promise<TImpact> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ImpactUnavailableError());
    }, IMPACT_TIMEOUT_MS);
  });
  let data: unknown;

  try {
    data = await Promise.race([
      apiFetch<unknown>(path, { query, signal: controller.signal }),
      timedOut,
    ]);
  } catch (error) {
    if (error instanceof ClientApiError) {
      throw error;
    }

    throw new ImpactUnavailableError();
  } finally {
    clearTimeout(timer);
  }

  if (!isExpected(data)) {
    throw new ImpactUnavailableError();
  }

  return data as TImpact;
}
