/**
 * DET-05 · el nombre del producto de cada línea de la compra enlaza a su
 * detalle con el `returnTo` encadenado al detalle de la compra.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import {
  PurchaseDetailProductsTable,
  type PurchaseDetailItemRow,
} from "./PurchaseDetailProductsTable";

const LIST = "/purchases?status=recibido&page=2";
const DETAIL_URL = `/purchases/purchase-1?returnTo=${encodeURIComponent(LIST)}`;

function line(overrides: Partial<PurchaseDetailItemRow> = {}): PurchaseDetailItemRow {
  return {
    product: { name: "Harina PAN 1 kg", sku: "HAR-001" },
    productId: "prod-harina",
    purchaseId: "purchase-1",
    quantity: 12,
    subtotalRef: 12,
    subtotalVes: 6000,
    unitCostRef: 1,
    unitCostVes: 500,
    ...overrides,
  };
}

function renderTable(
  items: PurchaseDetailItemRow[],
  props: { canViewProducts?: boolean; detailUrl?: string } = {},
) {
  return render(
    <PurchaseDetailProductsTable
      canViewProducts
      detailUrl={DETAIL_URL}
      discountRef={0}
      discountVes={0}
      items={items}
      status="recibido"
      taxRef={0}
      taxVes={0}
      totalRef={12}
      totalVes={6000}
      {...props}
    />,
  );
}

describe("PurchaseDetailProductsTable · enlace al producto (DET-05)", () => {
  it("enlaza el nombre al detalle del producto con el returnTo encadenado a la compra", () => {
    renderTable([line()]);

    const href = screen.getByRole("link", { name: "Harina PAN 1 kg" }).getAttribute("href");

    expect(href).toBe(`/products/prod-harina?returnTo=${encodeURIComponent(DETAIL_URL)}`);
    // De vuelta en la compra, esta sigue sabiendo volver a su lista filtrada.
    const returnTo = new URLSearchParams(href?.split("?")[1]).get("returnTo") as string;

    expect(returnTo).toBe(DETAIL_URL);
    expect(new URLSearchParams(returnTo.split("?")[1]).get("returnTo")).toBe(LIST);
  });

  it("sin permiso de ver productos el nombre va en texto plano", () => {
    renderTable([line()], { canViewProducts: false });

    expect(screen.getByText("Harina PAN 1 kg")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("por defecto (sin decir el permiso) no enlaza", () => {
    render(
      <PurchaseDetailProductsTable
        discountRef={0}
        discountVes={0}
        items={[line()]}
        status="recibido"
        taxRef={0}
        taxVes={0}
        totalRef={12}
        totalVes={6000}
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("una línea sin productId no enlaza; las demás sí", () => {
    renderTable([
      line({ product: { name: "Producto eliminado", sku: "" }, productId: "" }),
      line({ product: undefined, productId: "prod sin/ficha" }),
    ]);

    expect(screen.getByText("Producto eliminado")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Producto eliminado" })).not.toBeInTheDocument();
    // Sin ficha se muestra el id, y el id viaja codificado en la ruta.
    expect(screen.getByRole("link", { name: "prod sin/ficha" })).toHaveAttribute(
      "href",
      `/products/prod%20sin%2Fficha?returnTo=${encodeURIComponent(DETAIL_URL)}`,
    );
  });

  it("sin URL del detalle enlaza al producto sin returnTo", () => {
    renderTable([line()], { detailUrl: undefined });

    expect(screen.getByRole("link", { name: "Harina PAN 1 kg" })).toHaveAttribute(
      "href",
      "/products/prod-harina",
    );
  });
});
