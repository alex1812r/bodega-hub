/**
 * DET-05 · el nombre del producto de cada renglón de la venta enlaza a su
 * detalle con el `returnTo` encadenado al detalle de la venta.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import type { SaleItemWithProduct } from "../../hooks/useSales";
import { SaleDetailProductsTable } from "./SaleDetailProductsTable";

const LIST = "/sales?status=pagada&page=3";
const DETAIL_URL = `/sales/sale-1?returnTo=${encodeURIComponent(LIST)}`;

function line(overrides: Partial<SaleItemWithProduct> = {}): SaleItemWithProduct {
  return {
    product: { id: "prod-arroz", name: "Arroz Mary 1 kg", sku: "ARR-001" } as SaleItemWithProduct["product"],
    productId: "prod-arroz",
    quantity: 2,
    saleId: "sale-1",
    subtotalRef: 3,
    subtotalVes: 1500,
    unitCostRefSnapshot: 1,
    unitPriceRef: 1.5,
    ...overrides,
  };
}

describe("SaleDetailProductsTable · enlace al producto (DET-05)", () => {
  it("enlaza el nombre al detalle del producto con el returnTo encadenado a la venta", () => {
    render(<SaleDetailProductsTable canViewProducts detailUrl={DETAIL_URL} items={[line()]} />);

    const href = screen.getByRole("link", { name: "Arroz Mary 1 kg" }).getAttribute("href");

    expect(href).toBe(`/products/prod-arroz?returnTo=${encodeURIComponent(DETAIL_URL)}`);

    const returnTo = new URLSearchParams(href?.split("?")[1]).get("returnTo") as string;

    expect(returnTo).toBe(DETAIL_URL);
    expect(new URLSearchParams(returnTo.split("?")[1]).get("returnTo")).toBe(LIST);
  });

  it("sin permiso de ver productos el nombre va en texto plano", () => {
    render(<SaleDetailProductsTable detailUrl={DETAIL_URL} items={[line()]} />);

    expect(screen.getByText("Arroz Mary 1 kg")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("un renglón sin productId no enlaza; los demás sí", () => {
    render(
      <SaleDetailProductsTable
        canViewProducts
        detailUrl={DETAIL_URL}
        items={[
          line({
            product: { name: "Producto eliminado" } as SaleItemWithProduct["product"],
            productId: "",
          }),
          line(),
        ]}
      />,
    );

    expect(screen.getByText("Producto eliminado")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Arroz Mary 1 kg" })).toBeInTheDocument();
  });

  it("sin URL del detalle enlaza al producto sin returnTo", () => {
    render(<SaleDetailProductsTable canViewProducts items={[line()]} />);

    expect(screen.getByRole("link", { name: "Arroz Mary 1 kg" })).toHaveAttribute(
      "href",
      "/products/prod-arroz",
    );
  });
});
