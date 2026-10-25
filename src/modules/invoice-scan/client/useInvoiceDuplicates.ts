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
 *
 * `pending` (REP12-01 intento 2): la consulta vigente aún no tiene respuesta (espera o en
 * vuelo), así que ni el aviso del escaneo vale para ella; Cargar no debe cargar. No lo está si
 * falló (vuelve al aviso del escaneo) ni si es `answered`: la consulta que el escaneo ya
 * respondió con la misma regla (proveedor leído, número y fecha leídos).
 */
export function useInvoiceDuplicates(
  query: InvoiceDuplicateQuery | null,
  fetcher: InvoiceDuplicatesFetcher = fetchInvoiceDuplicates,
  answered: InvoiceDuplicateQuery | null = null,
): { matches: InvoiceDuplicateMatch[] | undefined; pending: boolean } {
  const key = query ? JSON.stringify(query) : null;
  const answeredKey = answered ? JSON.stringify(answered) : null;
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

  const current = result !== null && result.key === key ? result : null;
  return { matches: current?.matches, pending: key !== null && key !== answeredKey && current === null };
}
