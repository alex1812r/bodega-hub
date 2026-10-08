import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import type { PurchaseStatus } from "@/shared/mocks/erp-data";

import { PurchaseDetailActionsMenu } from "./PurchaseDetailActionsMenu";

// Permisos que el rol NO tiene; vacío = admin.
let mockDenied: string[] = [];

jest.mock("next/navigation", () => ({
  usePathname: () => "/purchases/pur 1",
}));
jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: (permission: string) => !mockDenied.includes(permission) }),
}));

function openMenu(status: PurchaseStatus = "recibido") {
  render(
    <PurchaseDetailActionsMenu
      onCancel={jest.fn()}
      onExportPdf={jest.fn()}
      onReturn={jest.fn()}
      purchaseNumber="COM-0001"
      status={status}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Acciones de/ }));
}

beforeEach(() => {
  mockDenied = [];
});

describe("PurchaseDetailActionsMenu · Duplicar compra (COM-09)", () => {
  it.each<PurchaseStatus>(["pedido", "recibido", "cancelado", "devuelto"])(
    "con permiso de crear compras ofrece Duplicar compra en estado %s y lleva al formulario con el id",
    (status) => {
      openMenu(status);

      expect(screen.getByRole("menuitem", { name: "Duplicar compra" })).toHaveAttribute(
        "href",
        "/purchases/create?duplicate=pur%201",
      );
    },
  );

  it("sin permiso de crear compras no la ofrece", () => {
    mockDenied = ["purchases.create"];
    openMenu();

    expect(screen.getByRole("menuitem", { name: "Descargar PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Duplicar compra" })).not.toBeInTheDocument();
  });
});
