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

/**
 * Lo que el modelo deja vacío no es un dato: Gemini devuelve `taxId: ""` cuando
 * no encuentra el RIF (qa-final O3). Se quita antes de emparejar para que la RPC
 * reciba `null` y nadie compare contra un RIF vacío.
 */
export function normalizeExtractionForMatch(extraction: InvoiceExtraction): InvoiceExtraction {
  const { taxId, ...supplier } = extraction.supplier;
  const trimmed = taxId?.trim();

  return trimmed ? extraction : { ...extraction, supplier };
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
