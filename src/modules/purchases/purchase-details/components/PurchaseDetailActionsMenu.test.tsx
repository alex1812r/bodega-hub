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
  const handlers = { onCancel: jest.fn(), onExportPdf: jest.fn(), onReturn: jest.fn() };

  render(<PurchaseDetailActionsMenu {...handlers} purchaseNumber="COM-0001" status={status} />);
  fireEvent.click(screen.getByRole("button", { name: /^Acciones de/ }));

  return handlers;
}

function labels() {
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
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

describe("PurchaseDetailActionsMenu · cancelar y devolver según el estado (CNF-05)", () => {
  it.each<[PurchaseStatus, string[]]>([
    ["pedido", ["Descargar PDF", "Duplicar compra", "Cancelar"]],
    ["recibido", ["Descargar PDF", "Duplicar compra", "Devolver", "Cancelar"]],
    ["cancelado", ["Descargar PDF", "Duplicar compra"]],
    ["devuelto", ["Descargar PDF", "Duplicar compra"]],
  ])("en estado %s ofrece %j", (status, expected) => {
    openMenu(status);

    expect(labels()).toEqual(expected);
  });

  it("sin permiso de crear compras no ofrece cancelar ni devolver", () => {
    mockDenied = ["purchases.create"];
    openMenu();

    expect(labels()).toEqual(["Descargar PDF"]);
  });

  it("«Cancelar» y «Devolver» solo piden abrir su confirmación; el menú no ejecuta ni confirma nada", () => {
    const first = openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar" }));

    expect(first.onCancel).toHaveBeenCalledTimes(1);
    expect(first.onReturn).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("«Descargar PDF» descarga directamente, sin diálogo de confirmación (CNF-13)", () => {
    const { onExportPdf } = openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Descargar PDF" }));

    expect(onExportPdf).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
