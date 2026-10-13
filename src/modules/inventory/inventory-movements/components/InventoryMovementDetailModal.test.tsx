import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));

import type { InventoryMovement } from "../../hooks/useInventory";
import { InventoryMovementDetailModal } from "./InventoryMovementDetailModal";

const base: InventoryMovement = {
  createdAt: "2026-10-05T16:00:00.000Z",
  documentKind: null,
  documentNumber: null,
  id: "mov-1",
  productId: "p-harina",
  quantityDelta: -6,
  reason: "Conteo físico",
  stockAfter: -4,
  type: "ajuste_salida",
};

function renderModal(movement: InventoryMovement) {
  return render(
    <InventoryMovementDetailModal
      movement={movement}
      onOpenChange={() => undefined}
      open
      returnTo="/inventory/movements?type=venta"
    />,
  );
}

describe("InventoryMovementDetailModal · documento", () => {
  it("says 'Ajuste manual' for a movement without a document and highlights a negative balance", () => {
    renderModal(base);

    expect(screen.getByText("Documento")).toBeInTheDocument();
    expect(screen.getByText("Ajuste manual")).toBeInTheDocument();
    expect(screen.queryByText("Manual")).not.toBeInTheDocument();
    expect(screen.getByText("-4")).toHaveClass("text-error");
  });

  it("links the sale number to its detail with returnTo = the list", () => {
    renderModal({
      ...base,
      documentKind: "venta",
      documentNumber: "V-0001",
      saleId: "sale-1",
      stockAfter: 18,
      type: "venta",
    });

    expect(screen.getByRole("link", { name: "V-0001" })).toHaveAttribute(
      "href",
      `/sales/sale-1?returnTo=${encodeURIComponent("/inventory/movements?type=venta")}`,
    );
    expect(screen.getByText("18")).not.toHaveClass("text-error");
  });

  it("says 'Conversión de empaque' for a conversion", () => {
    renderModal({
      ...base,
      conversionId: "conv-1",
      documentKind: "conversion",
      type: "conversion_salida",
    });

    expect(screen.getByText("Conversión de empaque")).toBeInTheDocument();
  });
});
