/**
 * REP14-05 (M-qa1401-1, mismo criterio que D63) · `findDuplicateScans`: en el posible duplicado
 * (sin número, o a un carácter) un escaneo previo casa por fecha si casa su fecha LEÍDA
 * (`readDate`) o su fecha EFECTIVA (`date`: la confirmada si no está vacía, si no la leída), y por
 * total igual con `readTotal` / `total`. QA REP14-01 §5b: previo de Market Catia sin número, fecha
 * leída 2020-07-05 y confirmada 2026-07-05; la revisión con la fecha corregida no avisaba.
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
    date: "2026-07-05",
    readDate: "2020-07-05",
    total: 7705.05,
    readTotal: 7705.05,
    purchaseId: "purchase-s5",
    purchaseStatus: "recibido",
    ...extra,
  };
}

function current(date: string | undefined, total: number, previousScans: MatchPreviousScan[], number?: string) {
  return { number, date, total, contactId: CATIA, supplierId: CATIA, taxId: undefined, previousScans };
}

const ids = (scans: MatchPreviousScan[]) => scans.map((scan) => scan.scanId);

describe("findDuplicateScans · REP14-05 (fecha y total leídos o confirmados)", () => {
  it("s5: fecha confirmada 2026-07-05 (leída 2020-07-05): la revisión con la fecha corregida avisa", () => {
    expect(ids(findDuplicateScans(current("2026-07-05", 7705.05, [previous()])))).toEqual(["scan-previo"]);
  });

  it("s5: con la fecha leída del previo también avisa", () => {
    expect(ids(findDuplicateScans(current("2020-07-05", 7705.05, [previous()])))).toEqual(["scan-previo"]);
  });

  it("s6: total confirmado 7706.06 (leído 7760.06): con el total corregido avisa, y con el leído también", () => {
    const s6 = previous({ date: "2026-07-06", readDate: "2026-07-06", total: 7706.06, readTotal: 7760.06 });
    expect(ids(findDuplicateScans(current("2026-07-06", 7706.06, [s6])))).toEqual(["scan-previo"]);
    expect(ids(findDuplicateScans(current("2026-07-06", 7760.06, [s6])))).toEqual(["scan-previo"]);
  });

  it("número a un carácter + fecha leída del previo (confirmada otra): avisa", () => {
    const conNumero = previous({ number: "00001028", readNumber: "00001028" });
    expect(ids(findDuplicateScans(current("2020-07-05", 7705.05, [conNumero], "00001029")))).toEqual(["scan-previo"]);
  });

  it("ni la fecha leída ni la confirmada, o ningún total: no avisa (como antes)", () => {
    expect(findDuplicateScans(current("2026-07-07", 7705.05, [previous()]))).toEqual([]);
    expect(findDuplicateScans(current("2026-07-05", 7800, [previous()]))).toEqual([]);
  });
});
