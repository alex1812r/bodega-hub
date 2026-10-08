import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  createPackDraftItem,
  createUnitDraftItem,
  type PurchaseDraftItem,
  type PurchaseLineCatalogMeta,
  type PurchaseLineTax,
  type PurchaseTaxCatalog,
} from "../types";
import { purchaseLineGridClassName } from "../utils/purchaseCreateStyles";
import { PurchaseLineRow } from "./PurchaseLineRow";

const RATE_VES = 510;

const tax: PurchaseLineTax = {
  categoryCode: "general",
  code: "general",
  label: "General",
  manual: false,
  rate: 16,
};

const taxCatalog: PurchaseTaxCatalog = {
  error: null,
  isLoading: false,
  rates: [
    {
      code: "general",
      id: "tax-general",
      isActive: true,
      isDefault: true,
      isGlobal: true,
      label: "General",
      pct: 16,
      sortOrder: 30,
    },
  ],
  refetch: () => undefined,
};

const switchMeta: PurchaseLineCatalogMeta = {
  name: "Interruptor sencillo",
  packUnits: [],
  sku: "sup-int-001",
  taxRate: 16,
};

const unitItem = createUnitDraftItem({
  costCurrency: "ves",
  id: "line-switch",
  productId: "prod-switch",
  quantity: 3,
  rateVes: RATE_VES,
  taxRate: 16,
  unitCostRef: 2,
});

const packItem = createPackDraftItem({
  costCurrency: "ves",
  id: "line-switch-pack",
  packCostRef: 12,
  packCount: 2,
  packLabel: "Caja",
  productId: "prod-switch",
  rateVes: RATE_VES,
  taxRate: 16,
  unitsPerPack: 12,
});

function Harness({ initialLocked, item }: { initialLocked: boolean; item: PurchaseDraftItem }) {
  const [locked, setLocked] = useState(initialLocked);

  return (
    <ul>
      <PurchaseLineRow
        item={item}
        locked={locked}
        meta={switchMeta}
        onLockChange={setLocked}
        onRemove={() => undefined}
        onSettle={() => undefined}
        onTaxChange={() => undefined}
        onUpdate={() => undefined}
        rateVes={RATE_VES}
        tax={tax}
        taxCatalog={taxCatalog}
      />
    </ul>
  );
}

function row() {
  return screen.getByRole("listitem");
}

describe("PurchaseLineRow · foco al desbloquear con doble clic (COM-F1)", () => {
  it("una línea por unidad deja el foco en su Cantidad", async () => {
    const user = userEvent.setup();
    render(<Harness initialLocked item={unitItem} />);

    await user.dblClick(screen.getByText("Interruptor sencillo"));

    expect(row()).not.toHaveAttribute("data-locked");
    expect(screen.getByLabelText("Cantidad de Interruptor sencillo")).toHaveFocus();
  });

  it("una línea por empaque deja el foco en sus Empaques", async () => {
    const user = userEvent.setup();
    render(<Harness initialLocked item={packItem} />);

    await user.dblClick(screen.getByText("Interruptor sencillo"));

    expect(screen.getByLabelText("Cantidad de caja de Interruptor sencillo")).toHaveFocus();
  });

  it("desbloquear con el candado conserva el foco en el candado", async () => {
    const user = userEvent.setup();
    render(<Harness initialLocked item={unitItem} />);

    await user.click(screen.getByRole("button", { name: "Desbloquear Interruptor sencillo" }));

    expect(screen.getByRole("button", { name: "Bloquear Interruptor sencillo" })).toHaveFocus();
  });
});

describe("PurchaseLineRow · reparto de columnas en tarjeta estrecha (COM-F1)", () => {
  it("la rejilla reserva anchos fijos a Cantidad, Costo, Total y acciones y deja el resto al producto", () => {
    render(<Harness initialLocked={false} item={unitItem} />);

    expect(purchaseLineGridClassName).toContain(
      "@xl:grid-cols-[minmax(0,1fr)_4.5rem_7rem_8rem_4.25rem]",
    );
    expect(row()).toHaveClass("grid", "grid-cols-3", "gap-x-3", "@xl:gap-x-2");
  });

  it("de 36 a 48rem el nombre queda en la columna Producto y SKU + chips en una fila propia a todo el ancho", () => {
    render(<Harness initialLocked={false} item={unitItem} />);

    const name = screen.getByText("Interruptor sencillo");
    const sku = screen.getByText("sup-int-001");
    const metaRow = sku.parentElement;
    const productCell = metaRow?.parentElement;

    expect(name).toHaveAttribute("title", "Interruptor sencillo");
    expect(name).toHaveClass("min-w-0", "@xl:truncate");
    expect(name.parentElement).toHaveClass("min-w-0");

    expect(productCell).toHaveClass("col-span-2", "min-w-0", "@xl:contents", "@3xl:block");
    expect(metaRow).toHaveClass(
      "min-w-0",
      "flex-wrap",
      "@xl:col-span-full",
      "@xl:row-start-2",
      "@xl:flex-nowrap",
    );
    expect(sku).toHaveAttribute("title", "sup-int-001");
    expect(sku).toHaveClass("min-w-0", "truncate");
    expect(screen.getByRole("button", { name: "Empaque de Interruptor sencillo" })).toHaveClass(
      "shrink-0",
    );
    expect(metaRow).toContainElement(
      screen.getByRole("button", { name: "Empaque de Interruptor sencillo" }),
    );
  });

  it("la fila bloqueada usa la misma rejilla: a 619 px de tarjeta la columna Producto mide 175 px y cabe SKU + alícuota", () => {
    render(<Harness initialLocked item={unitItem} />);

    const detail = screen.getByText("sup-int-001 · IVA General 16 %");

    expect(row()).toHaveAttribute("data-locked", "true");
    expect(row()).toHaveClass(
      "@xl:grid-cols-[minmax(0,1fr)_4.5rem_7rem_8rem_4.25rem]",
      "@xl:gap-x-2",
    );
    expect(detail).toHaveClass("truncate");
    expect(detail.parentElement).toHaveClass("min-w-0", "@xl:col-span-1");
  });
});
