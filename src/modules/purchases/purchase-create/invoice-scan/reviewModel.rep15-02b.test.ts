/**
 * REP15-02b (QA REP15-02, B-qa1502-2): el criterio del aviso de duplicado usa la misma validez de
 * fecha que la consulta (`buildInvoiceDuplicateQuery`, `getInvoiceDateIssue`). Una fecha imposible
 * no viaja en la consulta, así que el criterio no puede decir «fecha y total».
 */
import { buildInvoiceDuplicateQuery } from "@/modules/invoice-scan/client/fetchInvoiceDuplicates";

import { duplicateCriterionLabel } from "./components/invoiceReviewView";

const SUPPLIER = "sup-1";

describe("duplicateCriterionLabel · REP15-02b (B-qa1502-2)", () => {
  it.each(["2026-02-31", "31/02/2026", "29/02/2027", "00/01/2026", "hoy", "17.10.2026", "\u00a0\t"])(
    "sin número y fecha %j que la consulta omite: el criterio es el total",
    (date) => {
      expect(buildInvoiceDuplicateQuery({ supplierId: SUPPLIER, number: "", date, total: 10 })).toEqual({
        supplierId: SUPPLIER,
        total: 10,
      });
      expect(duplicateCriterionLabel({ number: "", date })).toBe("mismo proveedor y total");
    },
  );

  it.each(["2028-02-29", "29/02/2028", "17-10-2026\u3000"])(
    "sin número y fecha válida %j que la consulta manda: el criterio es fecha y total",
    (date) => {
      expect(buildInvoiceDuplicateQuery({ supplierId: SUPPLIER, number: "", date, total: 10 })?.date).toBeDefined();
      expect(duplicateCriterionLabel({ number: "", date })).toBe("mismo proveedor, fecha y total");
    },
  );
});
