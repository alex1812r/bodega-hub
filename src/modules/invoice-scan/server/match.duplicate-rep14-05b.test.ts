/**
 * REP14-05b · `findDuplicateScans`: la fecha del escaneo previo (leída o confirmada) puede estar
 * guardada como DD/MM/AAAA o DD-MM-AAAA (formatos que la revisión admite; 7 confirmadas así en el
 * lab, «14/10/2026»). Se compara por la fecha del calendario, no por el texto: «14/10/2026» es
 * «2026-10-14». El total ya se comparaba como número (±0,01).
 */
import type { MatchPreviousScan } from "./match.types";
import { findDuplicateScans } from "./match/duplicate";

const CATIA = "contact-market-catia";

function previous(extra: Partial<MatchPreviousScan> = {}): MatchPreviousScan {
  return {
    scanId: "scan-previo",
    supplierId: CATIA,
    matchedContactId: CATIA,
    supplierTaxId: null,
    number: null,
    readNumber: null,
    date: "14/10/2026",
    readDate: "2026-10-12",
    total: 24138.02,
    readTotal: 24138.02,
    purchaseId: "purchase-previa",
    purchaseStatus: "recibido",
    ...extra,
  };
}

function current(date: string | undefined, total: number, previousScans: MatchPreviousScan[]) {
  return { number: undefined, date, total, contactId: CATIA, supplierId: CATIA, taxId: undefined, previousScans };
}

const ids = (scans: MatchPreviousScan[]) => scans.map((scan) => scan.scanId);

describe("findDuplicateScans · REP14-05b (fecha DD/MM/AAAA del previo)", () => {
  it("fecha confirmada 14/10/2026: la revisión con 2026-10-14 avisa", () => {
    expect(ids(findDuplicateScans(current("2026-10-14", 24138.02, [previous()])))).toEqual(["scan-previo"]);
  });

  it("fecha leída 7-10-2026 (día de un dígito, guion): la revisión con 2026-10-07 avisa", () => {
    const leida = previous({ date: "7-10-2026", readDate: "7-10-2026" });
    expect(ids(findDuplicateScans(current("2026-10-07", 24138.02, [leida])))).toEqual(["scan-previo"]);
  });

  it("la fecha del escaneo actual en DD/MM/AAAA también casa con la ISO del previo", () => {
    expect(ids(findDuplicateScans(current("12/10/2026", 24138.02, [previous()])))).toEqual(["scan-previo"]);
  });

  it("otro día, mes y día cruzados o basura: no avisa y no falla", () => {
    expect(findDuplicateScans(current("2026-10-15", 24138.02, [previous()]))).toEqual([]);
    expect(findDuplicateScans(current("2026-14-10", 24138.02, [previous()]))).toEqual([]);
    expect(findDuplicateScans(current("2026-10-14", 24138.02, [previous({ date: "14/10/26xx" })]))).toEqual([]);
  });
});
