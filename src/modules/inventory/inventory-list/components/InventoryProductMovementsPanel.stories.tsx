import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import type { InventoryMovement } from "../../hooks/useInventory";
import { InventoryProductMovementsPanel } from "./InventoryProductMovementsPanel";

/**
 * Kardex en línea de un producto de `/inventory`: stock actual, los 10 últimos
 * movimientos con el saldo tras cada uno y su documento, y el enlace al kardex
 * completo. Para admin, una línea que explica el descuadre.
 *
 * Las historias simulan `GET /api/inventory/movements` con MSW.
 */
const meta = {
  args: {
    id: "inventory-movements-arr-002",
    product: { currentStock: 9, id: "arr-002", name: "Arroz blanco 1 kg" },
    returnTo: "/inventory?product=arr-002",
  },
  component: InventoryProductMovementsPanel,
  tags: ["ai-generated"],
  title: "Modules/Inventory/InventoryProductMovementsPanel",
} satisfies Meta<typeof InventoryProductMovementsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

function movement(overrides: Partial<InventoryMovement>): InventoryMovement {
  return {
    createdAt: "2024-03-31T15:20:00.000Z",
    documentKind: null,
    documentNumber: null,
    id: "mov-1",
    productId: "arr-002",
    quantityDelta: 1,
    stockAfter: 1,
    type: "ajuste_entrada",
    ...overrides,
  };
}

const movements: InventoryMovement[] = [
  movement({
    documentKind: "venta",
    documentNumber: "V-000231",
    id: "mov-5",
    quantityDelta: -3,
    saleId: "sale-231",
    stockAfter: 9,
    type: "venta",
  }),
  movement({
    createdAt: "2024-03-29T13:05:00.000Z",
    documentKind: "compra",
    documentNumber: "C-000045",
    id: "mov-4",
    purchaseId: "purchase-45",
    quantityDelta: 24,
    stockAfter: 12,
    type: "compra",
  }),
  movement({
    createdAt: "2024-03-27T19:40:00.000Z",
    id: "mov-3",
    quantityDelta: -2,
    reason: "Conteo físico: dos bolsas rotas",
    stockAfter: -12,
    type: "ajuste_salida",
  }),
  movement({
    conversionId: "conv-7",
    createdAt: "2024-03-25T14:10:00.000Z",
    documentKind: "conversion",
    id: "mov-2",
    quantityDelta: 12,
    stockAfter: -10,
    type: "conversion_entrada",
  }),
  movement({
    createdAt: "2024-03-20T12:00:00.000Z",
    documentKind: "venta",
    documentNumber: "V-000198",
    id: "mov-1",
    quantityDelta: -22,
    saleId: "sale-198",
    stockAfter: -22,
    type: "venta",
  }),
];

function movementsHandler(items: InventoryMovement[]) {
  return http.get("/api/inventory/movements", () =>
    HttpResponse.json({ data: { items, limit: 10, skip: 0, total: items.length } }),
  );
}

/** Venta y compra enlazadas, un ajuste manual con motivo y una conversión. */
export const Default: Story = {
  parameters: { msw: { handlers: [movementsHandler(movements)] } },
};

/** Admin con descuadre: el stock no coincide con la suma de movimientos. */
export const WithReconciliationDiff: Story = {
  args: {
    product: { currentStock: 9, id: "arr-002", name: "Arroz blanco 1 kg", reconciliationDiff: 3 },
  },
  parameters: { msw: { handlers: [movementsHandler(movements)] } },
};

/** Producto sin movimientos. */
export const Empty: Story = {
  args: { product: { currentStock: 0, id: "arr-002", name: "Arroz blanco 1 kg" } },
  parameters: { msw: { handlers: [movementsHandler([])] } },
};

/** El servidor falla: se ofrece reintentar. */
export const Failed: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/inventory/movements", () =>
          HttpResponse.json(
            { error: { code: "INTERNAL", message: "No se pudieron leer los movimientos." } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
};
