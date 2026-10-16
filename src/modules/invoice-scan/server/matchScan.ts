import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { InvoiceExtraction, InvoiceMatch } from "../contracts";

import { loadMatchContext, type MatchContextSupabaseClient } from "./loadMatchContext";
import { matchInvoice } from "./match";
import { loadMockMatchContext } from "./matchContext.mock-server";

export type MatchScanContext = {
  storeId: string;
  dataSource: "supabase" | "mock";
  /** Escaneo ya reservado que se empareja: se excluye de su propia detección de duplicados. */
  scanId: string;
};

export type InvoiceScanMatcher = (
  extraction: InvoiceExtraction,
  ctx: MatchScanContext,
) => Promise<InvoiceMatch>;

export type MatchScanDeps = {
  /** Cliente con la sesión del usuario: `invoice_match_candidates` mira `auth.uid()` y su tienda. */
  createClient: () => Promise<MatchContextSupabaseClient>;
  loadContext: typeof loadMatchContext;
  loadMockContext: typeof loadMockMatchContext;
};

const defaultDeps: MatchScanDeps = {
  createClient: createRouteSupabaseClient,
  loadContext: loadMatchContext,
  loadMockContext: loadMockMatchContext,
};

/** Copia de `value` sin las claves de texto opcional presentes pero vacías o solo con espacios. */
function withoutBlank<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const blank = keys.filter((key) => {
    const text = value[key];
    return key in value && (typeof text !== "string" || text.trim() === "");
  });

  if (blank.length === 0) {
    return value;
  }

  const copy = { ...value };
  for (const key of blank) {
    delete copy[key];
  }

  return copy;
}

/**
 * Lo que el modelo deja vacío no es un dato: Gemini devuelve `taxId: ""` cuando
 * no encuentra el RIF (qa-final O3), y lo mismo con el número, el teléfono, la
 * dirección, el código de barras o el código del proveedor. En el borde del
 * servidor (SCN-13a), antes de guardar `extracted` y de emparejar, esos textos
 * opcionales vacíos o solo con espacios quedan ausentes: la RPC recibe `null` y
 * nadie compara contra un RIF vacío. Los textos con contenido no se tocan.
 * Idempotente; devuelve la misma referencia si no había nada que quitar.
 */
export function normalizeExtractionForMatch(extraction: InvoiceExtraction): InvoiceExtraction {
  const top = withoutBlank(extraction, ["number"]);
  const supplier = withoutBlank(extraction.supplier, ["taxId", "phone", "address"]);
  const lines = extraction.lines.map((line) => withoutBlank(line, ["barcode", "supplierSku"]));
  const linesChanged = lines.some((line, index) => line !== extraction.lines[index]);

  if (top === extraction && supplier === extraction.supplier && !linesChanged) {
    return extraction;
  }

  return { ...top, lines: linesChanged ? lines : extraction.lines, supplier };
}

/**
 * Empareja la lectura con el catálogo de la tienda de la sesión (`ctx.storeId`):
 * en Supabase, `matchInvoice(extraction, await loadMatchContext(supabase, storeId, extraction, { excludeScanId: scanId }))`;
 * en mock, el mismo `matchInvoice` con `loadMockMatchContext`.
 */
export function createMatchScan(deps: MatchScanDeps = defaultDeps): InvoiceScanMatcher {
  return async (raw, { dataSource, scanId, storeId }) => {
    const extraction = normalizeExtractionForMatch(raw);

    if (dataSource === "mock") {
      return matchInvoice(extraction, deps.loadMockContext(storeId, extraction, { excludeScanId: scanId }));
    }

    const supabase = await deps.createClient();

    return matchInvoice(extraction, await deps.loadContext(supabase, storeId, extraction, { excludeScanId: scanId }));
  };
}

export const matchScan: InvoiceScanMatcher = createMatchScan();
