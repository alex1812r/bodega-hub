/**
 * @jest-environment node
 */

import type { InventoryMovement } from "../../hooks/useInventory";
import { movementExportColumns } from "../utils/movementExportColumns";
import { toMovementExportRow } from "./exportMovementsExcel";

const documentColumn = movementExportColumns.find((column) => column.header === "Documento");

function movement(overrides: Partial<InventoryMovement>): InventoryMovement {
  return {
    createdAt: "2026-10-05T16:00:00.000Z",
    documentKind: null,
    documentNumber: null,
    id: "mov-1",
    productId: "p-harina",
    quantityDelta: 1,
    stockAfter: 10,
    type: "ajuste_entrada",
    ...overrides,
  };
}

function exportedDocument(overrides: Partial<InventoryMovement>) {
  return documentColumn?.value(toMovementExportRow(movement(overrides)));
}

describe("toMovementExportRow", () => {
  it("carries the document of each movement to the 'Documento' column", () => {
    expect(
      exportedDocument({ documentKind: "venta", documentNumber: "V-0001", saleId: "sale-1" }),
    ).toBe("V-0001");
    expect(
      exportedDocument({ documentKind: "compra", documentNumber: "C-0007", purchaseId: "p-7" }),
    ).toBe("C-0007");
    expect(exportedDocument({ conversionId: "conv-1", documentKind: "conversion" })).toBe(
      "Conversión de empaque",
    );
    expect(exportedDocument({})).toBe("Ajuste manual");
  });

  it("keeps the balance after the movement, also when it is negative", () => {
    expect(toMovementExportRow(movement({ stockAfter: -4 })).stockAfter).toBe(-4);
  });
});
