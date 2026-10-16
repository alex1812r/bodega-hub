import type { InvoiceExtraction, InvoiceMatch } from "../../contracts";
import type { MatchSupplierCandidate } from "../match.types";

import { formatDecimal, normalizeTaxId, sameTaxId, textSimilarity } from "./text";

/** Score mínimo del nombre para resolver el proveedor sin RIF. */
export const SUPPLIER_NAME_MIN_SCORE = 0.8;
/** Margen mínimo del primero sobre el segundo para resolver por nombre (si no, elige el usuario). */
export const SUPPLIER_NAME_MIN_MARGIN = 0.1;
/** Candidatos de proveedor devueltos al usuario. */
export const SUPPLIER_MAX_CANDIDATES = 3;

type SupplierResult = InvoiceMatch["supplier"];
type ScoredSupplier = { candidate: MatchSupplierCandidate; score: number };

function scoreByName(name: string, candidates: MatchSupplierCandidate[]): ScoredSupplier[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: candidate.score ?? textSimilarity(name, candidate.name),
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
}

function toCandidate(entry: ScoredSupplier, reason: string) {
  return {
    contactId: entry.candidate.contactId,
    name: entry.candidate.name,
    score: entry.score,
    reason,
  };
}

/**
 * Proveedor del documento:
 * 1. RIF igual (`sameTaxId`: dígitos, y letra si ambos la traen) al de UN
 *    solo contacto -> ese contacto. La RPC compara sin letra; aquí se descarta.
 * 2. Si no, por nombre: el mejor con score >= 0,8 y al menos 0,1 sobre el
 *    segundo -> ese contacto. No se resuelve por nombre un contacto cuyo RIF
 *    guardado contradice el RIF leído.
 * 3. Si no, solo candidatos (el usuario elige).
 */
export function resolveSupplier(
  supplier: InvoiceExtraction["supplier"],
  candidates: MatchSupplierCandidate[],
): SupplierResult {
  const readTaxId = normalizeTaxId(supplier.taxId);

  if (readTaxId) {
    const byTaxId = candidates.filter((candidate) => sameTaxId(supplier.taxId, candidate.taxId));
    if (byTaxId.length === 1) {
      return {
        contactId: byTaxId[0].contactId,
        candidates: [toCandidate({ candidate: byTaxId[0], score: 1 }, "RIF igual")],
      };
    }
  }

  const scored = scoreByName(supplier.name, candidates);
  const listed = scored
    .slice(0, SUPPLIER_MAX_CANDIDATES)
    .map((entry) => toCandidate(entry, `nombre parecido ${formatDecimal(entry.score)}`));
  const [first, second] = scored;
  const firstTaxId = first ? normalizeTaxId(first.candidate.taxId) : "";
  const taxIdCompatible = !readTaxId || !firstTaxId || sameTaxId(supplier.taxId, first?.candidate.taxId);

  if (
    first &&
    taxIdCompatible &&
    first.score >= SUPPLIER_NAME_MIN_SCORE &&
    (!second || first.score - second.score >= SUPPLIER_NAME_MIN_MARGIN)
  ) {
    return { contactId: first.candidate.contactId, candidates: listed };
  }

  return listed.length > 0 ? { candidates: listed } : {};
}
