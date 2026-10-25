"use client";

import { useEffect, useRef, useState } from "react";

import type { InvoiceDuplicateMatch, InvoiceDuplicateQuery } from "../contracts";
import { fetchInvoiceDuplicates } from "./fetchInvoiceDuplicates";

/** Espera tras el último cambio (número tecleado, proveedor) antes de consultar. */
export const INVOICE_DUPLICATES_DEBOUNCE_MS = 300;

export type InvoiceDuplicatesFetcher = (
  query: InvoiceDuplicateQuery,
  signal: AbortSignal,
) => Promise<InvoiceDuplicateMatch[]>;

type Result = { key: string; matches?: InvoiceDuplicateMatch[] };

/**
 * REP12-01 (D52): duplicados de la revisión con el proveedor elegido. Cada cambio de la consulta
 * aborta la petición anterior (y la espera de `INVOICE_DUPLICATES_DEBOUNCE_MS`); la respuesta de
 * una consulta que ya no es la vigente no se usa. `matches` es `undefined` mientras no hay
 * respuesta para la consulta vigente, sin consulta, o si falló: quien lo usa se queda entonces
 * con el aviso que trajo el escaneo (`matched.duplicateOfScanId`).
 */
export function useInvoiceDuplicates(
  query: InvoiceDuplicateQuery | null,
  fetcher: InvoiceDuplicatesFetcher = fetchInvoiceDuplicates,
): { matches: InvoiceDuplicateMatch[] | undefined } {
  const key = query ? JSON.stringify(query) : null;
  const [result, setResult] = useState<Result | null>(null);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    if (key === null) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetcherRef.current(JSON.parse(key) as InvoiceDuplicateQuery, controller.signal).then(
        (matches) => {
          if (!controller.signal.aborted) {
            setResult({ key, matches });
          }
        },
        () => {
          // Sin respuesta válida para esta consulta: el aviso vuelve al del escaneo.
          if (!controller.signal.aborted) {
            setResult({ key });
          }
        },
      );
    }, INVOICE_DUPLICATES_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  return { matches: result !== null && result.key === key ? result.matches : undefined };
}
