/**
 * DET-05 · «Ver movimientos de stock» de una venta o una compra: lleva a
 * `/inventory/movements` filtrado por ese documento, con `returnTo` encadenado.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { inventoryMovementsSchema } from "../inventory-movements/inventoryMovementsParams";
import {
  DocumentStockMovementsLink,
  getDocumentStockMovementsHref,
} from "./DocumentStockMovementsLink";

const LIST = "/sales?status=pagada&page=2";
const SALE_URL = `/sales/sale-1?returnTo=${encodeURIComponent(LIST)}`;

describe("DocumentStockMovementsLink", () => {
  it("filtra por la venta con saleId", () => {
    expect(getDocumentStockMovementsHref({ id: "sale-1", kind: "venta" })).toBe(
      "/inventory/movements?saleId=sale-1",
    );
  });

  it("filtra por la compra con purchaseId y codifica el id", () => {
    expect(getDocumentStockMovementsHref({ id: "compra 1&x", kind: "compra" })).toBe(
      "/inventory/movements?purchaseId=compra%201%26x",
    );
  });

  it("usa parámetros que la lista de movimientos reconoce", () => {
    const href = getDocumentStockMovementsHref({ id: "purchase-7", kind: "compra" });
    const params = Object.fromEntries(new URLSearchParams(href.split("?")[1]));

    expect(inventoryMovementsSchema.parse(params)).toMatchObject({
      purchaseId: "purchase-7",
      saleId: "",
    });
  });

  it("es un enlace real con el returnTo encadenado al detalle de origen", () => {
    render(
      <DocumentStockMovementsLink currentUrl={SALE_URL} document={{ id: "sale-1", kind: "venta" }} />,
    );

    const href = screen.getByRole("link", { name: "Ver movimientos de stock" }).getAttribute("href");

    expect(href).toBe(`/inventory/movements?saleId=sale-1&returnTo=${encodeURIComponent(SALE_URL)}`);

    const returnTo = new URLSearchParams(href?.split("?")[1]).get("returnTo") as string;

    // De vuelta en la venta, esta sigue sabiendo volver a su lista filtrada.
    expect(returnTo).toBe(SALE_URL);
    expect(new URLSearchParams(returnTo.split("?")[1]).get("returnTo")).toBe(LIST);
  });
});
