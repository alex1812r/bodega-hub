import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { createUnitDraftItem, type PurchaseLineTax } from "../types";
import { PurchaseLockedLineCells } from "./PurchaseLockedLineCells";

const tax: PurchaseLineTax = {
  categoryCode: "general",
  code: "general",
  label: "General",
  manual: false,
  rate: 16,
};

const item = createUnitDraftItem({
  costCurrency: "ves",
  id: "line-1",
  productId: "prod-1",
  quantity: 3,
  rateVes: 510,
  taxRate: 16,
  unitCostRef: 2,
});

describe("PurchaseLockedLineCells · línea secundaria (COM-F1)", () => {
  it("el SKU se recorta con su texto completo en title y la alícuota no cede ancho", () => {
    const sku = "SKU-MUY-LARGO-DEL-PROVEEDOR-0000000001";

    render(
      <PurchaseLockedLineCells
        item={item}
        meta={{ name: "Interruptor sencillo", packUnits: [], sku, taxRate: 16 }}
        tax={tax}
        totalRefText="REF 6,96"
        totalVesText="Bs 3.549,60"
      />,
    );

    const skuElement = screen.getByText(sku);
    const taxElement = screen.getByText(/IVA General 16\s?%/);

    expect(skuElement).toHaveAttribute("title", sku);
    expect(skuElement).toHaveClass("min-w-0", "truncate");
    expect(taxElement).toHaveClass("shrink-0");
    expect(taxElement).not.toHaveClass("truncate");
    expect(taxElement.parentElement).toBe(skuElement.parentElement);
    expect(skuElement.parentElement).toHaveClass("flex", "min-w-0");
    expect(skuElement.parentElement).not.toHaveClass("truncate");
  });
});
