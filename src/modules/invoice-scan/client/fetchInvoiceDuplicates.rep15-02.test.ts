/**
 * REP15-02 · `buildInvoiceDuplicateQuery`.
 * - B-p16B-3: una fecha imposible («2026-02-31») no va en la consulta (el endpoint responde 400 y
 *   el aviso dice «No se pudo comprobar…»); se consulta sin fecha, como con `dateInvalid`.
 * - B-p16B-1: una fecha DD/MM/AAAA válida va como AAAA-MM-DD (la del escaneo y la de la revisión
 *   dan la misma consulta).
 * - B-p16-1: el número va sin espacios Unicode ni tabuladores (un tab en medio no lo descarta).
 */
import { buildInvoiceDuplicateQuery } from "./fetchInvoiceDuplicates";

const SUPPLIER = "contact-market-catia";

describe("buildInvoiceDuplicateQuery · REP15-02", () => {
  it.each(["2026-02-31", "31/02/2026", "2026-13-01", "1899-01-01"])("fecha %s: la consulta va sin fecha", (date) => {
    expect(buildInvoiceDuplicateQuery({ supplierId: SUPPLIER, date, total: 1750 })).toEqual({
      supplierId: SUPPLIER,
      total: 1750,
    });
  });

  it.each([
    ["17/10/2026", "2026-10-17"],
    ["7-10-2026", "2026-10-07"],
    ["2026-10-17\u00a0", "2026-10-17"],
  ])("fecha válida %j: va como %s", (date, iso) => {
    expect(buildInvoiceDuplicateQuery({ supplierId: SUPPLIER, date, total: 1750 })).toEqual({
      supplierId: SUPPLIER,
      date: iso,
      total: 1750,
    });
  });

  it("número con tabulador o salto en medio: va sin ellos", () => {
    expect(buildInvoiceDuplicateQuery({ supplierId: SUPPLIER, number: "FACTURA\n000\t1234\u00a0" })).toEqual({
      supplierId: SUPPLIER,
      number: "FACTURA0001234",
    });
  });
});
