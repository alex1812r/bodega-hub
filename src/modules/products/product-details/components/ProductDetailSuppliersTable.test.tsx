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
