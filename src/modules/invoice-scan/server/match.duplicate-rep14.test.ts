/**
 * REP14-01 intento 2 (M-p15-1, D63) · `findDuplicateScans`: un escaneo previo casa por número si
 * casa su número LEÍDO (`readNumber`) o su número EFECTIVO (`number`: el confirmado si no está
 * vacío, si no el leído); y un previo SIN ningún número (ni leído ni confirmado) sigue saliendo por
 * fecha + total + proveedor aunque el actual traiga número (teclear el número no apaga la red).
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
    number: "00001028",
    readNumber: "00901028",
    date: "2026-10-08",
    total: 315708.83,
    purchaseId: "purchase-f12",
    purchaseStatus: "recibido",
    ...extra,
  };
}

function current(number: string | undefined, previousScans: MatchPreviousScan[], extra: { date?: string } = {}) {
  return {
    number,
    date: "date" in extra ? extra.date : "2026-10-08",
    total: 315708.83,
    contactId: CATIA,
    supplierId: CATIA,
    taxId: undefined,
    previousScans,
  };
}

const ids = (scans: MatchPreviousScan[]) => scans.map((scan) => scan.scanId);

describe("findDuplicateScans · REP14-01 (leído o confirmado; previo sin número)", () => {
  it("el modelo vuelve a leer el mismo número erróneo y el usuario no lo corrige: casa por el leído del previo", () => {
    expect(ids(findDuplicateScans(current("00901028", [previous()], { date: undefined })))).toEqual(["scan-previo"]);
  });

  it("el usuario teclea el número confirmado: casa por el confirmado del previo", () => {
    expect(ids(findDuplicateScans(current("00001028", [previous()], { date: undefined })))).toEqual(["scan-previo"]);
  });

  it("previo sin número leído ni confirmado, actual con número: sale por fecha + total + proveedor", () => {
    const sinNumero = previous({ number: null, readNumber: null });
    expect(ids(findDuplicateScans(current("00001028", [sinNumero])))).toEqual(["scan-previo"]);
  });

  it("previo sin número, actual con número pero sin fecha: no hay posible duplicado (como antes)", () => {
    const sinNumero = previous({ number: null, readNumber: null });
    expect(findDuplicateScans(current("00001028", [sinNumero], { date: undefined }))).toEqual([]);
  });

  it("previo con otro número lejano (leído y confirmado): misma fecha y total no bastan (como antes)", () => {
    const otro = previous({ number: "00557711", readNumber: "00557711" });
    expect(findDuplicateScans(current("00001028", [otro]))).toEqual([]);
  });

  it("previo sin número pero de otro proveedor: no sale", () => {
    const ajeno = previous({ number: null, readNumber: null, supplierId: "contact-otro", matchedContactId: "contact-otro" });
    expect(findDuplicateScans(current("00001028", [ajeno]))).toEqual([]);
  });
});
