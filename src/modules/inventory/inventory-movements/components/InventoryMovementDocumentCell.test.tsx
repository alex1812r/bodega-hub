/**
 * INV-F3 · documento de un movimiento: el enlace a la venta o compra lleva la
 * URL de la lista entera, con el `returnTo` con el que se llegó a ella.
 *
 * DET-05 · auditoría por tipo de movimiento (compra, venta, devolución, ajuste,
 * conversión de empaque) y permiso para ver el documento.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

let mockPermissions: string[] = [];

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockPermissions.includes(permission),
  }),
}));

import { InventoryMovementDocumentCell } from "./InventoryMovementDocumentCell";

const ORIGIN = "/products/p-1";
const LIST_URL = `/inventory/movements?productId=p-1&returnTo=${encodeURIComponent(ORIGIN)}`;

function returnToOf(href: string | null) {
  return new URLSearchParams((href ?? "").split("?")[1] ?? "").get("returnTo");
}

describe("InventoryMovementDocumentCell", () => {
  beforeEach(() => {
    mockPermissions = ["sales.view", "purchases.view"];
  });

  it("links a customer return to the sale it returns and a supplier return to its purchase", () => {
    // Una devolución ligada llega con el vínculo a su documento y sin `documentKind` en el kardex.
    const { unmount } = render(
      <InventoryMovementDocumentCell
        movement={{ documentNumber: "V-000123", saleId: "sale-1" }}
        returnTo="/inventory/movements?type=devolucion_cliente"
      />,
    );

    expect(screen.getByRole("link", { name: "V-000123" })).toHaveAttribute(
      "href",
      `/sales/sale-1?returnTo=${encodeURIComponent("/inventory/movements?type=devolucion_cliente")}`,
    );
    unmount();

    render(
      <InventoryMovementDocumentCell
        movement={{ documentNumber: "C-000045", purchaseId: "purchase-1" }}
        returnTo="/inventory/movements?type=devolucion_proveedor"
      />,
    );

    expect(screen.getByRole("link", { name: "C-000045" })).toHaveAttribute(
      "href",
      `/purchases/purchase-1?returnTo=${encodeURIComponent("/inventory/movements?type=devolucion_proveedor")}`,
    );
  });

  it("shows a pack opening as plain text: it has no screen of its own", () => {
    render(
      <InventoryMovementDocumentCell
        movement={{ conversionId: "conv-1", documentKind: "conversion" }}
        returnTo={LIST_URL}
      />,
    );

    expect(screen.getByText("Conversión de empaque")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the sale number as plain text without sales.view", () => {
    mockPermissions = ["purchases.view"];
    render(
      <InventoryMovementDocumentCell
        movement={{ documentKind: "venta", documentNumber: "V-000123", saleId: "sale-1" }}
        returnTo={LIST_URL}
      />,
    );

    expect(screen.getByText("V-000123")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the purchase number as plain text without purchases.view", () => {
    mockPermissions = ["sales.view"];
    render(
      <InventoryMovementDocumentCell
        movement={{ documentKind: "compra", documentNumber: "C-000045", purchaseId: "purchase-1" }}
        returnTo={LIST_URL}
      />,
    );

    expect(screen.getByText("C-000045")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the returnTo of the list nested in the link to the sale", () => {
    render(
      <InventoryMovementDocumentCell
        movement={{ documentKind: "venta", documentNumber: "V-000123", saleId: "sale-1" }}
        returnTo={LIST_URL}
      />,
    );

    const href = screen.getByRole("link", { name: "V-000123" }).getAttribute("href");

    expect(href?.split("?")[0]).toBe("/sales/sale-1");
    expect(returnToOf(href)).toBe(LIST_URL);
    expect(returnToOf(returnToOf(href))).toBe(ORIGIN);
  });

  it("gives the same link as before when the list has no returnTo", () => {
    render(
      <InventoryMovementDocumentCell
        movement={{ documentKind: "compra", documentNumber: "C-000045", purchaseId: "purchase-1" }}
        returnTo="/inventory/movements?type=compra"
      />,
    );

    expect(screen.getByRole("link", { name: "C-000045" })).toHaveAttribute(
      "href",
      `/purchases/purchase-1?returnTo=${encodeURIComponent("/inventory/movements?type=compra")}`,
    );
  });

  it("shows a movement without document as plain text", () => {
    render(<InventoryMovementDocumentCell movement={{}} returnTo={LIST_URL} />);

    expect(screen.getByText("Ajuste manual")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
