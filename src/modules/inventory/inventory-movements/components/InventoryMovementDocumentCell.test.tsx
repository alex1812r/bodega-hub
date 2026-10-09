/**
 * INV-F3 · documento de un movimiento: el enlace a la venta o compra lleva la
 * URL de la lista entera, con el `returnTo` con el que se llegó a ella.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { InventoryMovementDocumentCell } from "./InventoryMovementDocumentCell";

const ORIGIN = "/products/p-1";
const LIST_URL = `/inventory/movements?productId=p-1&returnTo=${encodeURIComponent(ORIGIN)}`;

function returnToOf(href: string | null) {
  return new URLSearchParams((href ?? "").split("?")[1] ?? "").get("returnTo");
}

describe("InventoryMovementDocumentCell", () => {
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
