import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useReducer, useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import type { TaxRate } from "@/shared/hooks/useTaxRates";

import {
  createPackDraftItem,
  createUnitDraftItem,
  type PurchaseCostCurrency,
  type PurchaseDraftItem,
  type PurchaseLineLockControls,
  type PurchaseTaxCatalog,
} from "../types";
import { EMPTY_PURCHASE_LINES_STATE, purchaseLinesReducer } from "../hooks/usePurchaseLines";
import { withPurchaseLineDisassemble } from "../utils/purchaseLineDisassemble";
import { lockPurchaseLines } from "../utils/purchaseLineLocks";
import { settlePurchaseLines } from "../utils/purchaseLineReview";
import {
  buildPurchaseWebLines,
  EMPTY_PURCHASE_TAX_STATE,
  setPurchaseExempt,
} from "../utils/purchaseLineTax";
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

function taxRate(code: string, label: string, pct: number, sortOrder: number): TaxRate {
  return {
    code,
    id: `tax-${code}`,
    isActive: true,
    isDefault: code === "general",
    isGlobal: true,
    label,
    pct,
    sortOrder,
  };
}

const taxRates = [
  taxRate("exento", "Exento", 0, 10),
  taxRate("reducida", "Reducida", 8, 20),
  taxRate("general", "General", 16, 30),
];
const taxCatalog: PurchaseTaxCatalog = {
  error: null,
  isLoading: false,
  rates: taxRates,
  refetch: () => undefined,
};

const metaByProductId: Record<string, PurchaseLineItemMeta> = {
  "prod-cable": { name: "Cable HDMI 2 m", packUnits: [], sku: "ELE-CAB-001", taxRate: 16 },
  // Categoría con un porcentaje que ninguna alícuota activa tiene.
  "prod-licor": { name: "Ron añejo 750 ml", packUnits: [], sku: "LIC-RON-001", taxRate: 31 },
  "prod-refresco": {
    name: "Refresco Cola 2 L retornable",
    packUnits: [cajaPack],
    sku: "BEB-REF-001",
    taxRate: 16,
  },
};

const staticLockControls: PurchaseLineLockControls = {
  lockOnAdd: true,
  onLockAll: () => undefined,
  onLockOnAddChange: () => undefined,
  onToggleLine: () => undefined,
  onUnlockAll: () => undefined,
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

type LinesHarnessProps = {
  costCurrency: PurchaseCostCurrency;
  /** "Compra exenta" activo: todas las líneas nacen en Exento. */
  exempt?: boolean;
  /** Las líneas nacen bloqueadas (y por tanto asentadas). */
  locked?: boolean;
  /** Las líneas ya están asentadas: cualquier cambio las marca como editadas. */
  settled?: boolean;
  /** Añade una línea cuya categoría no tiene alícuota activa. */
  withUnresolvedLine?: boolean;
};

function LinesHarness({
  costCurrency,
  exempt = false,
  locked = false,
  settled = false,
  withUnresolvedLine = false,
}: LinesHarnessProps) {
  const [lockOnAdd, setLockOnAdd] = useState(true);
  const [{ items, locks, review, taxState }, dispatch] = useReducer(purchaseLinesReducer, null, () => {
    const initialItems = [
      ...buildItems(costCurrency),
      ...(withUnresolvedLine
        ? [
            createUnitDraftItem({
              costCurrency,
              id: "line-licor",
              productId: "prod-licor",
              rateVes: RATE_VES,
              taxRate: 31,
              unitCostRef: 9,
            }),
          ]
        : []),
    ];
    const initialTaxState = exempt ? setPurchaseExempt(true) : EMPTY_PURCHASE_TAX_STATE;

    return {
      ...EMPTY_PURCHASE_LINES_STATE,
      items: initialItems,
      locks: locked
        ? lockPurchaseLines(
            EMPTY_PURCHASE_LINES_STATE.locks,
            initialItems.map((item) => item.id),
          )
        : EMPTY_PURCHASE_LINES_STATE.locks,
      review: settled || locked
        ? settlePurchaseLines(EMPTY_PURCHASE_LINES_STATE.review, initialItems, initialTaxState)
        : EMPTY_PURCHASE_LINES_STATE.review,
      taxState: initialTaxState,
    };
  });
  const lines = buildPurchaseWebLines({
    getCategoryPct: (productId) => metaByProductId[productId]?.taxRate ?? 0,
    items,
    locks,
    rateVes: RATE_VES,
    rates: taxRates,
    review,
    taxState,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-container-lowest">
      <PurchaseLineItemsTable
        getItemMeta={(productId) =>
          metaByProductId[productId] ?? { name: "Producto", sku: "—", taxRate: 0 }
        }
        lines={lines}
        lockControls={{
          lockOnAdd,
          onLockAll: () => dispatch({ type: "allLinesLocked" }),
          onLockOnAddChange: setLockOnAdd,
          onToggleLine: (itemId, nextLocked) =>
            dispatch({ itemId, locked: nextLocked, type: "lineLockChanged" }),
          onUnlockAll: () => dispatch({ type: "allLinesUnlocked" }),
        }}
        onLineTaxChange={(itemId, code) => dispatch({ code, itemId, type: "lineTaxChosen" })}
        onRemoveItem={(itemId) => dispatch({ itemId, type: "lineRemoved" })}
        onSettleItem={(itemId) => dispatch({ itemId, type: "lineSettled" })}
        onUpdateItem={(itemId, input) =>
          dispatch({ input, itemId, rateVes: RATE_VES, type: "lineUpdated" })
        }
        rateVes={RATE_VES}
        taxCatalog={taxCatalog}
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

/** El chip de IVA abre las alícuotas del catálogo; elegir una cierra la lista y recalcula el total. */
export const TaxRateChange: Story = {
  name: "Cambiar la alícuota de una línea",
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(body.getByRole("button", { name: "IVA de Cable HDMI 2 m: IVA 16 %" }));
    await userEvent.click(await body.findByRole("radio", { name: /Reducida/ }));

    await expect(body.queryByRole("radiogroup")).not.toBeInTheDocument();
    await expect(
      body.getByRole("button", { name: "IVA de Cable HDMI 2 m: IVA 8 %" }),
    ).toBeVisible();
  },
};

/**
 * Cambiar un valor de una línea ya asentada: la celda se resalta al salir, la fila
 * muestra el punto "Línea editada" y `Esc` deshace el cambio.
 */
export const EditedLine: Story = {
  args: { settled: true },
  name: "Línea editada",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const quantity = canvas.getByLabelText("Cantidad de Cable HDMI 2 m");

    await userEvent.clear(quantity);
    await userEvent.type(quantity, "8");
    await userEvent.tab();

    await expect(quantity).toHaveAttribute("data-flash", "true");
    await expect(canvas.getByRole("img", { name: "Línea editada" })).toBeVisible();

    await userEvent.click(quantity);
    await userEvent.keyboard("{Escape}");
    await expect(quantity).toHaveValue("3");
    await expect(canvas.queryByRole("img", { name: "Línea editada" })).not.toBeInTheDocument();
  },
};

/**
 * Líneas bloqueadas: filas compactas de solo lectura, sin campos. Se desbloquean
 * con el candado o con doble clic; "Bloquear todas" las vuelve a cerrar.
 */
export const LockedLines: Story = {
  args: { locked: true },
  name: "Líneas bloqueadas",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = within(canvas.getByRole("list", { name: "Líneas de la compra" }));

    await expect(list.queryByRole("textbox")).not.toBeInTheDocument();
    await expect(list.queryByRole("combobox")).not.toBeInTheDocument();
    await expect(list.getByText("2 × 12 u")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Bloquear todas" })).toBeDisabled();

    await userEvent.dblClick(list.getByText("Cable HDMI 2 m"));
    await expect(canvas.getByLabelText("Cantidad de Cable HDMI 2 m")).toBeVisible();

    await userEvent.click(
      canvas.getByRole("button", { name: "Desbloquear Refresco Cola 2 L retornable" }),
    );
    await expect(list.getAllByRole("textbox")).toHaveLength(4);

    await userEvent.click(canvas.getByRole("button", { name: "Bloquear todas" }));
    await expect(list.queryByRole("textbox")).not.toBeInTheDocument();
  },
};

/** Con "Compra exenta" todas las líneas muestran Exento. */
export const ExemptPurchase: Story = {
  args: { exempt: true },
  name: "Compra exenta",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByRole("button", { name: /: Exento$/ })).toHaveLength(2);
  },
};

/** Ninguna alícuota activa coincide con la de la categoría: la línea pide elegir una. */
export const UnresolvedTaxRate: Story = {
  args: { withUnresolvedLine: true },
  name: "Línea sin alícuota válida",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Elige una alícuota")).toBeVisible();
  },
};

/**
 * COM-14: los productos que son el empaque de una receta de apertura ofrecen el chip
 * "Desarmar al recibir"; aquí la primera línea lo trae marcado y la segunda sin marcar.
 */
export const DisassembleOnReceive: Story = {
  name: "Chip «Desarmar al recibir»",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chips = canvas.getAllByRole("button", { name: /^Desarmar al recibir / });

    await expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  },
  render: () => {
    const items = buildItems("ves");

    return (
      <PurchaseLineItemsTable
        getItemMeta={(productId) =>
          metaByProductId[productId] ?? { name: "Producto", sku: "—", taxRate: 0 }
        }
        lines={withPurchaseLineDisassemble(
          buildPurchaseWebLines({
            getCategoryPct: () => 16,
            items,
            rateVes: RATE_VES,
            rates: taxRates,
            taxState: EMPTY_PURCHASE_TAX_STATE,
          }),
          items[0] ? { [items[0].id]: true } : {},
          new Set(items.slice(0, 2).map((item) => item.productId)),
        )}
        lockControls={staticLockControls}
        onLineDisassembleChange={() => undefined}
        onLineTaxChange={() => undefined}
        onRemoveItem={() => undefined}
        onSettleItem={() => undefined}
        onUpdateItem={() => undefined}
        rateVes={RATE_VES}
        taxCatalog={taxCatalog}
      />
    );
  },
};

export const TaxRatesLoading: Story = {
  name: "Alícuotas cargando",
  render: () => (
    <PurchaseLineItemsTable
      getItemMeta={(productId) =>
        metaByProductId[productId] ?? { name: "Producto", sku: "—", taxRate: 0 }
      }
      lines={buildPurchaseWebLines({
        getCategoryPct: () => 16,
        items: buildItems("ves"),
        rateVes: RATE_VES,
        rates: [],
        taxState: EMPTY_PURCHASE_TAX_STATE,
      })}
      lockControls={staticLockControls}
      onLineTaxChange={() => undefined}
      onRemoveItem={() => undefined}
      onSettleItem={() => undefined}
      onUpdateItem={() => undefined}
      rateVes={RATE_VES}
      taxCatalog={{ ...taxCatalog, isLoading: true, rates: [] }}
    />
  ),
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

/**
 * Tarjeta de 619 px (la de `/purchases/create` con el viewport a 1280 px): el nombre va
 * en la columna Producto (175 px) y SKU + chips en una fila propia a todo el ancho, sin
 * pisar Cantidad, Costo ni Total. Desde 768 px de tarjeta vuelven bajo el nombre.
 */
export const NarrowCard: Story = {
  decorators: [
    (StoryComponent) => (
      <div className="w-[619px]">
        <StoryComponent />
      </div>
    ),
  ],
  name: "Tarjeta de 619 px (viewport 1280)",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByRole("button", { name: "Empaque de Cable HDMI 2 m" });
    const quantity = canvas.getByLabelText("Cantidad de Cable HDMI 2 m");

    await expect(canvas.getByText("ELE-CAB-001")).toBeVisible();
    await expect(chip.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      quantity.getBoundingClientRect().bottom,
    );
  },
};

/** La misma tarjeta de 619 px con las líneas bloqueadas: SKU y alícuota caben enteros. */
export const NarrowCardLocked: Story = {
  args: { locked: true },
  decorators: NarrowCard.decorators,
  name: "Tarjeta de 619 px: líneas bloqueadas",
};

export const Empty: Story = {
  render: () => (
    <PurchaseLineItemsTable
      getItemMeta={() => ({ name: "Producto", sku: "—", taxRate: 0 })}
      lines={[]}
      lockControls={staticLockControls}
      onLineTaxChange={() => undefined}
      onRemoveItem={() => undefined}
      onSettleItem={() => undefined}
      onUpdateItem={() => undefined}
      rateVes={RATE_VES}
      taxCatalog={taxCatalog}
    />
  ),
};
