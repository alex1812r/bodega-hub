import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InventoryMovementsTable } from "./InventoryMovementsTable";

/**
 * Tabla del libro de movimientos: documento (número con enlace, "Conversión de
 * empaque" o "Ajuste manual") y saldo tras el movimiento; un saldo negativo
 * histórico se muestra tal cual, resaltado.
 */
const meta = {
  component: InventoryMovementsTable,
  tags: ["ai-generated"],
  args: {
    returnTo: "/inventory/movements?type=compra",
    rows: [
      {
        createdAt: "2026-05-18T14:30:00.000Z",
        documentKind: "compra",
        documentNumber: "C-0001",
        id: "MOV-001",
        product: "Aceite 1L",
        productSku: "ACE-1L",
        purchaseId: "purchase-001",
        quantity: 12,
        reason: "Recepción de compra",
        stockAfter: 24,
        type: "compra",
      },
      {
        createdAt: "2026-05-18T15:10:00.000Z",
        documentKind: "venta",
        documentNumber: "V-0042",
        id: "MOV-002",
        product: "Aceite 1L",
        productSku: "ACE-1L",
        quantity: -2,
        saleId: "sale-042",
        stockAfter: 22,
        type: "venta",
      },
      {
        conversionId: "conv-001",
        createdAt: "2026-05-18T16:00:00.000Z",
        documentKind: "conversion",
        documentNumber: null,
        id: "MOV-003",
        product: "Refresco 355 ml",
        productSku: "REF-010",
        quantity: 24,
        reason: "Apertura de bulto",
        stockAfter: 30,
        type: "conversion_entrada",
      },
      {
        createdAt: "2026-05-18T17:00:00.000Z",
        documentKind: null,
        documentNumber: null,
        id: "MOV-004",
        product: "Azúcar 1 kg",
        productSku: "AZU-004",
        quantity: -6,
        reason: "Conteo físico",
        stockAfter: -4,
        type: "ajuste_salida",
      },
    ],
  },
} satisfies Meta<typeof InventoryMovementsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Tienda sin movimientos. */
export const Empty: Story = {
  args: { rows: [] },
};

/** Ningún movimiento coincide con los filtros. */
export const EmptyWithFilters: Story = {
  args: { emptyKind: "filtered", onClearFilters: () => undefined, rows: [] },
};

/** Rango de fechas invertido: no se consultó. */
export const InvalidRange: Story = {
  args: { emptyKind: "invalid-range", rows: [] },
};

export const Loading: Story = {
  args: { isLoading: true, rows: [] },
};

export const WithError: Story = {
  args: { error: "No se pudo completar la solicitud.", onRetry: () => undefined, rows: [] },
};
