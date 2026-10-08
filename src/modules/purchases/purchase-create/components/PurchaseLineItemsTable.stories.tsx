import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  createPackDraftItem,
  createUnitDraftItem,
  type PurchaseCostCurrency,
  type PurchaseDraftItem,
} from "../types";
import { syncLineCostFields } from "../utils/normalizePurchaseLine";
import { PurchaseLineItemsTable, type PurchaseLineItemMeta } from "./PurchaseLineItemsTable";

const RATE_VES = 510;

const cajaPack = {
  id: "pack-caja",
  isActive: true,
  isDefault: true,
  label: "Caja",
  supplierProductId: "supp-refresco",
  unitsPerPack: 12,
};

const metaByProductId: Record<string, PurchaseLineItemMeta> = {
  "prod-cable": { name: "Cable HDMI 2 m", packUnits: [], sku: "ELE-CAB-001", taxRate: 16 },
  "prod-refresco": {
    name: "Refresco Cola 2 L retornable",
    packUnits: [cajaPack],
    sku: "BEB-REF-001",
    taxRate: 16,
  },
};

function buildItems(costCurrency: PurchaseCostCurrency): PurchaseDraftItem[] {
  return [
    createUnitDraftItem({
      costCurrency,
      id: "line-cable",
      productId: "prod-cable",
      quantity: 3,
      rateVes: RATE_VES,
      taxRate: 16,
      unitCostRef: 2,
    }),
    createPackDraftItem({
      costCurrency,
      id: "line-refresco",
      packCostRef: 12,
      packCount: 2,
      packLabel: cajaPack.label,
      packUnitId: cajaPack.id,
      productId: "prod-refresco",
      rateVes: RATE_VES,
      taxRate: 16,
      unitsPerPack: cajaPack.unitsPerPack,
    }),
  ];
}

function LinesHarness({ costCurrency }: { costCurrency: PurchaseCostCurrency }) {
  const [items, setItems] = useState(() => buildItems(costCurrency));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-container-lowest">
      <PurchaseLineItemsTable
        getItemMeta={(productId) =>
          metaByProductId[productId] ?? { name: "Producto", sku: "—", taxRate: 0 }
        }
        items={items}
        onRemoveItem={(itemId) => setItems((current) => current.filter((item) => item.id !== itemId))}
        onUpdateItem={(itemId, input) =>
          setItems((current) =>
            current.map((item) =>
              item.id === itemId ? syncLineCostFields({ ...item, ...input }, RATE_VES) : item,
            ),
          )
        }
        rateVes={RATE_VES}
      />
    </div>
  );
}

const meta = {
  args: { costCurrency: "ves" },
  component: LinesHarness,
  tags: ["ai-generated"],
  title: "Modules/Purchases/PurchaseLineItemsTable",
} satisfies Meta<typeof LinesHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Una línea por unidad (dos inputs) y una en modo empaque (chip activo y desplegado). */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByLabelText("Cantidad de Cable HDMI 2 m")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Empaque de Refresco Cola 2 L retornable" }),
    ).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(canvas.getByRole("button", { name: "Empaque de Cable HDMI 2 m" }));
    await expect(
      canvas.getByRole("combobox", { name: "Tipo de empaque de Cable HDMI 2 m" }),
    ).toBeVisible();
  },
};

export const CostsInRef: Story = {
  args: { costCurrency: "ref" },
};

/** Tarjeta estrecha (móvil 390 px): la línea se apila sin desbordes. */
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "390 px: línea apilada",
  parameters: {
    viewport: {
      options: {
        mobile390: {
          name: "Móvil 390 px",
          styles: { height: "844px", width: "390px" },
        },
      },
    },
  },
};

export const Empty: Story = {
  render: () => (
    <PurchaseLineItemsTable
      getItemMeta={() => ({ name: "Producto", sku: "—", taxRate: 0 })}
      items={[]}
      onRemoveItem={() => undefined}
      onUpdateItem={() => undefined}
      rateVes={RATE_VES}
    />
  ),
};
