/**
 * REP12-01 (M-p12-1, M-p12A-1; D52 + D53) · una sola regla de duplicado: mismo número
 * normalizado (o, sin número, misma fecha + total; o número a un carácter con misma fecha y
 * total) Y proveedor coincidente por el proveedor ELEGIDO, el contacto LEÍDO o el RIF LEÍDO,
 * en cualquier combinación entre el escaneo previo y el actual.
 */
import type { MatchPreviousScan } from "./match.types";
import { findDuplicateScan, findDuplicateScans } from "./match/duplicate";

const NORTE = "contact-norte";
const CAOS = "contact-caos";
const OTRO = "contact-otro";
const RIF = "J-40999888-1";

type Side = { chosen?: string; read?: string; rif?: string };

/** Escaneo previo confirmado con `chosen` (invoice_scans.supplier_id) y leído `read`/`rif`. */
function previous(side: Side, extra: Partial<MatchPreviousScan> = {}): MatchPreviousScan {
  return {
    scanId: "scan-previo",
    supplierId: side.chosen ?? side.read ?? null,
    matchedContactId: side.read ?? null,
    supplierTaxId: side.rif ?? null,
    number: "DUP-0001",
    date: "2026-10-20",
    total: 464,
    purchaseId: "purchase-1",
    purchaseStatus: "recibido",
    ...extra,
  };
}

function current(side: Side, extra: Partial<Parameters<typeof findDuplicateScan>[0]> = {}) {
  return {
    number: "DUP-0001",
    date: "2026-10-20",
    total: 464,
    contactId: side.read,
    supplierId: side.chosen,
    taxId: side.rif,
    ...extra,
  };
}

describe("findDuplicateScan · proveedor coincidente en cualquier combinación (D53)", () => {
  it.each<[string, Side, Side]>([
    ["previo elegido = actual elegido (D2: nada leído, elegido a mano)", { chosen: NORTE }, { chosen: NORTE }],
    ["previo elegido = actual leído", { chosen: NORTE }, { read: NORTE }],
    ["previo leído (cargado con otro) = actual leído (D3d, M-p12A-1)", { chosen: NORTE, read: CAOS }, { read: CAOS }],
    ["previo leído (cargado con otro) = actual elegido", { chosen: NORTE, read: CAOS }, { chosen: CAOS }],
    ["previo leído = actual elegido distinto del leído (D4)", { chosen: CAOS, read: CAOS }, { chosen: NORTE, read: CAOS }],
    ["previo elegido = actual elegido distinto del leído (f19, M-p12-1)", { chosen: NORTE, read: OTRO }, { chosen: NORTE, read: CAOS }],
    ["RIF leído en ambos, contactos distintos", { chosen: NORTE, rif: RIF }, { chosen: OTRO, rif: "j40999888-1" }],
  ])("%s → duplicado", (_label, prev, cur) => {
    expect(findDuplicateScan({ ...current(cur), previousScans: [previous(prev)] })).toBe("scan-previo");
  });

  it.each<[string, Side, Side]>([
    ["ningún proveedor en común", { chosen: NORTE, read: CAOS, rif: RIF }, { chosen: OTRO, read: OTRO, rif: "J-11111111-1" }],
    ["actual sin proveedor (ni leído ni elegido)", { chosen: NORTE, read: CAOS }, {}],
  ])("%s → sin duplicado", (_label, prev, cur) => {
    expect(findDuplicateScan({ ...current(cur), previousScans: [previous(prev)] })).toBeUndefined();
  });
});

describe("findDuplicateScan · número o fecha + total con el proveedor elegido (D52)", () => {
  it("sin número: misma fecha y total con el proveedor elegido", () => {
    expect(
      findDuplicateScan({
        ...current({ chosen: NORTE }, { number: undefined }),
        previousScans: [previous({ chosen: NORTE }, { number: null })],
      }),
    ).toBe("scan-previo");
  });

  it("D5: número a un carácter, misma fecha y total, previo confirmado con el elegido", () => {
    expect(
      findDuplicateScan({
        ...current({ chosen: NORTE }, { number: "DUP-0002" }),
        previousScans: [previous({ chosen: NORTE })],
      }),
    ).toBe("scan-previo");
  });

  it("otro número (más de un carácter) con el mismo proveedor no es duplicado", () => {
    expect(
      findDuplicateScan({
        ...current({ chosen: NORTE }, { number: "XYZ-9999" }),
        previousScans: [previous({ chosen: NORTE })],
      }),
    ).toBeUndefined();
  });

  it("la compra anulada no cuenta", () => {
    expect(
      findDuplicateScan({
        ...current({ chosen: NORTE }),
        previousScans: [previous({ chosen: NORTE }, { purchaseStatus: "cancelado" })],
      }),
    ).toBeUndefined();
  });
});

describe("findDuplicateScans · todos los que coinciden, el confirmado primero", () => {
  it("devuelve cada escaneo coincidente (para «Ver»), con los confirmados delante", () => {
    const abandoned = previous({ chosen: NORTE }, { scanId: "scan-abandonado", purchaseId: null });
    const confirmed = previous({ read: NORTE }, { scanId: "scan-confirmado" });
    const other = previous({ chosen: OTRO }, { scanId: "scan-otro" });

    expect(
      findDuplicateScans({ ...current({ chosen: NORTE }), previousScans: [abandoned, other, confirmed] }).map(
        (scan) => scan.scanId,
      ),
    ).toEqual(["scan-confirmado", "scan-abandonado"]);
  });
});

/**
 * REP12-01 intento 2 (D53 «cualquier combinación» incluye el RIF): el RIF de los contactos
 * implicados (proveedor elegido o contacto leído, del actual y del previo; resuelto desde
 * `contacts` de la tienda) se cruza con el RIF leído del otro lado y entre sí.
 */
describe("findDuplicateScan · RIF de los contactos cruzado con el RIF leído (D53)", () => {
  type Prev = Partial<MatchPreviousScan>;
  type Cur = Partial<Parameters<typeof findDuplicateScan>[0]>;
  const base = (prev: Prev, cur: Cur) => ({
    ...current({}, cur),
    previousScans: [previous({}, { supplierId: null, matchedContactId: null, supplierTaxId: null, ...prev })],
  });

  it.each<[string, Prev, Cur]>([
    [
      "RIF leído del previo = RIF del proveedor ELEGIDO actual",
      { supplierId: OTRO, supplierTaxId: RIF },
      { supplierId: NORTE, contactTaxIds: ["J409998881"] },
    ],
    [
      "RIF del proveedor elegido del previo = RIF leído actual",
      { supplierId: NORTE, contactTaxIds: [RIF] },
      { supplierId: OTRO, taxId: "j-40999888-1" },
    ],
    [
      "RIF del contacto leído del previo (cargado con otro) = RIF leído actual",
      { supplierId: OTRO, matchedContactId: CAOS, contactTaxIds: [RIF] },
      { contactId: NORTE, taxId: RIF },
    ],
    [
      "RIF del elegido del previo = RIF del elegido actual (contactos distintos, mismo RIF)",
      { supplierId: NORTE, contactTaxIds: [RIF] },
      { supplierId: OTRO, contactTaxIds: [RIF] },
    ],
    [
      "RIF leído del previo = RIF del contacto leído actual",
      { supplierId: OTRO, supplierTaxId: RIF },
      { contactId: NORTE, contactTaxIds: [RIF] },
    ],
  ])("%s → duplicado", (_label, prev, cur) => {
    expect(findDuplicateScan(base(prev, cur))).toBe("scan-previo");
  });

  it.each<[string, Prev, Cur]>([
    [
      "RIF distintos en todos los contactos",
      { supplierId: NORTE, supplierTaxId: "J-22222222-2", contactTaxIds: [RIF] },
      { supplierId: OTRO, taxId: "J-11111111-1", contactTaxIds: ["J-33333333-3"] },
    ],
    [
      "mismos dígitos con otra letra (V ≠ J)",
      { supplierId: NORTE, contactTaxIds: [RIF] },
      { supplierId: OTRO, contactTaxIds: ["V-40999888-1"] },
    ],
    ["contacto sin RIF guardado", { supplierId: NORTE, contactTaxIds: [] }, { supplierId: OTRO, contactTaxIds: [] }],
  ])("%s → sin duplicado", (_label, prev, cur) => {
    expect(findDuplicateScan(base(prev, cur))).toBeUndefined();
  });
});
