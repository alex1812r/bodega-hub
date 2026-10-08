import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";

import { createQueryWrapper } from "../../../inventory/utils/requestAttempt.testUtils";
import {
  ProductDetailSuppliersTable,
  type ProductSupplierRow,
} from "./ProductDetailSuppliersTable";

/** PRO-14 · chip "Habitual" en los proveedores del detalle del producto. */

jest.mock("../../../../shared/auth/Can", () => ({
  Can: () => null,
}));

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => false }),
}));

function row(
  supplierId: string,
  name: string,
  extra: Partial<ProductSupplierRow> = {},
): ProductSupplierRow {
  return {
    id: `link-${supplierId}`,
    isActive: true,
    lastCostRef: 2,
    productId: "prod-harina",
    supplier: {
      address: "",
      email: "",
      id: supplierId,
      isActive: true,
      name,
      phone: "",
      taxId: "",
      type: "proveedor",
    },
    supplierId,
    ...extra,
  } as ProductSupplierRow;
}

function renderTable(rows: ProductSupplierRow[]) {
  render(<ProductDetailSuppliersTable productId="prod-harina" rows={rows} salePriceRef={3} />, {
    wrapper: createQueryWrapper(),
  });
}

function tableRow(name: string) {
  return screen.getByRole("cell", { name: new RegExp(name) }).closest("tr")!;
}

describe("ProductDetailSuppliersTable · proveedor habitual (PRO-14)", () => {
  it("marca con el chip Habitual solo al proveedor habitual", () => {
    renderTable([
      row("sup-polar", "Alimentos Polar", { lastCostRef: 3 }),
      row("sup-mavesa", "Mavesa", { isPreferred: true }),
    ]);

    expect(within(tableRow("Mavesa")).getByText("Habitual")).toBeVisible();
    expect(within(tableRow("Alimentos Polar")).queryByText("Habitual")).not.toBeInTheDocument();
    expect(screen.getAllByText("Habitual")).toHaveLength(1);
  });

  it("sin proveedor habitual no hay chip", () => {
    renderTable([row("sup-polar", "Alimentos Polar"), row("sup-mavesa", "Mavesa")]);

    expect(screen.queryByText("Habitual")).not.toBeInTheDocument();
  });
});

/** PRO-F8 · un vínculo sin costo no compite por "más económico / mejor precio". */
describe("ProductDetailSuppliersTable · proveedores sin costo (PRO-F8)", () => {
  function card(label: string) {
    return screen.getByText(label).parentElement!;
  }

  it.each([
    ["0", 0],
    ["ausente", undefined],
  ])("un proveedor con costo %s no es el más económico ni el mejor precio", (_case, lastCostRef) => {
    renderTable([
      row("sup-norte", "Distribuidora Norte", { lastCostRef: 1.75 }),
      row("sup-sur", "Importadora Sur", { lastCostRef }),
    ]);

    expect(within(tableRow("Importadora Sur")).queryByText("Más económico")).not.toBeInTheDocument();
    expect(within(tableRow("Distribuidora Norte")).getByText("Más económico")).toBeVisible();

    expect(card("Mejor precio")).toHaveTextContent("Distribuidora Norte");
    expect(card("Mejor precio")).toHaveTextContent("ref 1.75");
    expect(card("Precio más alto")).toHaveTextContent("Distribuidora Norte");
    // Margen contra el mejor costo REAL (1,75 con venta 3), no contra 0.
    expect(card("Margen estimado")).toHaveTextContent("41.7%");
  });

  it("en la tabla un costo vacío se muestra como —, no como ref 0.00", () => {
    renderTable([
      row("sup-norte", "Distribuidora Norte", { lastCostRef: 1.75 }),
      row("sup-sur", "Importadora Sur", { lastCostRef: 0 }),
    ]);

    expect(within(tableRow("Importadora Sur")).getAllByRole("cell")[2]).toHaveTextContent(/^—$/);
    expect(within(tableRow("Distribuidora Norte")).getAllByRole("cell")[2]).toHaveTextContent(
      "ref 1.75",
    );
    expect(screen.queryByText("ref 0.00")).not.toBeInTheDocument();
  });

  it("si ningún proveedor tiene costo, no hay más económico y el resumen lo dice", () => {
    renderTable([
      row("sup-norte", "Distribuidora Norte", { lastCostRef: 0 }),
      row("sup-sur", "Importadora Sur", { lastCostRef: undefined }),
    ]);

    expect(screen.queryByText("Más económico")).not.toBeInTheDocument();
    expect(screen.queryByText("Mejor precio")).not.toBeInTheDocument();
    expect(screen.queryByText("Margen estimado")).not.toBeInTheDocument();
    expect(screen.getByText("Sin costos registrados.")).toBeVisible();
    expect(screen.queryByText("ref 0.00")).not.toBeInTheDocument();
  });

  it("un vínculo inactivo con costo no cuenta para el resumen ni es el más económico", () => {
    renderTable([
      row("sup-norte", "Distribuidora Norte", { isActive: false, lastCostRef: 1 }),
      row("sup-sur", "Importadora Sur", { lastCostRef: 0 }),
    ]);

    expect(screen.getByText("Sin costos registrados.")).toBeVisible();
    expect(screen.queryByText("Más económico")).not.toBeInTheDocument();
  });
});
