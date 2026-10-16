import { roundMoney } from "@bodega/core";

import type { InvoiceExtraction, InvoiceMatch } from "../contracts";

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

/** Diferencia máxima entre el total leído y el calculado antes de marcar `mismatch`. */
const TOTALS_TOLERANCE = 0.01;

// PUNTO DE INTEGRACIÓN (Emparejamiento SCN-05)
// Stub hasta integrar la rama de Emparejamiento. Al integrar, se sustituye por
// `matchInvoice(extraction, await loadMatchContext(supabase, storeId, extraction, { excludeScanId: scanId }))`
// con `storeId`, `dataSource` y `scanId` de `ctx`. Ninguna línea se empareja
// ni se toca un alias: todas llegan `unmatched` para que el usuario elija.
export const matchScan: InvoiceScanMatcher = async (extraction) => {
  const computed = roundMoney(extraction.lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const read = extraction.total;

  return {
    lines: extraction.lines.map((line, index) => ({
      entryMode: "unit",
      index,
      issues: [],
      status: "unmatched",
      taxRateCode: line.taxHint === "exento" ? "exento" : "general",
    })),
    supplier: {},
    totals: {
      computed,
      mismatch: read !== undefined && Math.abs(read - computed) > TOTALS_TOLERANCE,
      ...(read === undefined ? {} : { read }),
    },
  };
};
