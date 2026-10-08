import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import type { ProductKardex, ProductKardexMovement } from "../services/productKardex";
import { ProductKardexCard } from "./ProductKardexCard";

/**
 * Kardex del producto en su ficha: saldo actual con mínimo y estado, saldo
 * diario de 30 días (gráfico con resumen para lector de pantalla y los mismos
 * datos en una tabla oculta), entradas y salidas del periodo y los 10 últimos
 * movimientos con su documento. Solo se pinta con el permiso `inventory.view`.
 *
 * Estas historias simulan `GET /api/auth/me` y `GET /api/inventory/kardex` con MSW.
 */
const meta = {
  args: { productId: "prod-cable", returnTo: "/products/prod-cable" },
  component: ProductKardexCard,
  tags: ["ai-generated"],
  title: "Modules/Inventory/ProductKardexCard",
} satisfies Meta<typeof ProductKardexCard>;

export default meta;
type Story = StoryObj<typeof meta>;

function currentUserHandler(permissions: string[]) {
  return http.get("/api/auth/me", () =>
    HttpResponse.json({
      data: {
        deniedPermissions: [],
        grantedPermissions: [],
        permissionCatalog: permissions,
        permissions,
        role: "almacen",
        roles: ["almacen"],
        storeId: "00000000-0000-4000-8000-000000000001",
        user: { id: "user-almacen", isActive: true, name: "Usuario almacén" },
      },
    }),
  );
}

function kardexHandler(kardex: ProductKardex) {
  return http.get("/api/inventory/kardex", () => HttpResponse.json({ data: kardex }));
}

/** 30 días que terminan el 1 de abril de 2024 (la fecha fija de Storybook). */
function isoDay(index: number) {
  return new Date(Date.UTC(2024, 2, 3 + index, 12)).toISOString().slice(0, 10);
}

/** Serie a partir del saldo inicial y los movimientos netos por índice de día. */
function buildSeries(openingBalance: number, changes: Record<number, [number, number]>) {
  let balance = openingBalance;

  return Array.from({ length: 30 }, (_, index) => {
    const [entries, exits] = changes[index] ?? [0, 0];

    balance += entries - exits;

    return { balance, date: isoDay(index), entries, exits };
  });
}

function movement(overrides: Partial<ProductKardexMovement>): ProductKardexMovement {
  return {
    conversionId: null,
    createdAt: "2024-04-01T14:00:00.000Z",
    documentKind: null,
    documentNumber: null,
    id: "mov-1",
    purchaseId: null,
    quantityDelta: 1,
    reason: null,
    saleId: null,
    stockAfter: 1,
    type: "ajuste_entrada",
    ...overrides,
  };
}

const lastMovements: ProductKardexMovement[] = [
  movement({
    documentKind: "venta",
    documentNumber: "V-000128",
    id: "mov-6",
    quantityDelta: -2,
    saleId: "sale-128",
    stockAfter: 14,
    type: "venta",
  }),
  movement({
    createdAt: "2024-03-30T19:20:00.000Z",
    id: "mov-5",
    quantityDelta: -1,
    reason: "Unidad dañada en el mostrador",
    stockAfter: 16,
    type: "ajuste_salida",
  }),
  movement({
    createdAt: "2024-03-27T15:05:00.000Z",
    documentKind: "compra",
    documentNumber: "C-000045",
    id: "mov-4",
    purchaseId: "purchase-45",
    quantityDelta: 12,
    stockAfter: 17,
    type: "compra",
  }),
  movement({
    conversionId: "conv-7",
    createdAt: "2024-03-22T13:40:00.000Z",
    documentKind: "conversion",
    id: "mov-3",
    quantityDelta: 6,
    stockAfter: 5,
    type: "conversion_entrada",
  }),
  movement({
    createdAt: "2024-03-15T21:10:00.000Z",
    documentKind: "venta",
    documentNumber: "V-000101",
    id: "mov-2",
    quantityDelta: -9,
    saleId: "sale-101",
    stockAfter: -1,
    type: "venta",
  }),
  movement({
    createdAt: "2024-03-05T14:00:00.000Z",
    id: "mov-1",
    quantityDelta: 8,
    reason: "Conteo físico",
    stockAfter: 8,
    type: "inventario_inicial",
  }),
];

const normalKardex: ProductKardex = {
  entries30d: 26,
  exits30d: 12,
  lastMovements,
  openingBalance: 0,
  product: { currentStock: 14, id: "prod-cable", minStock: 5, name: "Cable HDMI", sku: "ELE-CAB-001" },
  // Incluye un tramo en negativo (del 15 al 21 de marzo): el eje baja de cero.
  series: buildSeries(0, {
    2: [8, 0],
    12: [0, 9],
    19: [6, 0],
    24: [12, 0],
    27: [0, 1],
    29: [0, 2],
  }),
  truncated: false,
};

const emptyKardex: ProductKardex = {
  entries30d: 0,
  exits30d: 0,
  lastMovements: [],
  openingBalance: 9,
  product: { currentStock: 9, id: "prod-cable", minStock: 5, name: "Cable HDMI", sku: "ELE-CAB-001" },
  series: buildSeries(9, {}),
  truncated: false,
};

const truncatedKardex: ProductKardex = {
  entries30d: 640,
  exits30d: 598,
  lastMovements: lastMovements.slice(0, 3),
  openingBalance: null,
  product: { currentStock: 342, id: "prod-cable", minStock: 50, name: "Cable HDMI", sku: "ELE-CAB-001" },
  // Solo los 4 últimos días se leyeron completos.
  series: buildSeries(300, { 26: [200, 150], 27: [120, 180], 28: [220, 140], 29: [100, 128] }).map(
    (point, index) =>
      index < 26 ? { balance: null, date: point.date, entries: null, exits: null } : point,
  ),
  truncated: true,
};

const canView = currentUserHandler(["inventory.view"]);

/** Datos normales: gráfico con un tramo en negativo, venta, compra, conversión y ajustes manuales. */
export const Default: Story = {
  parameters: { msw: { handlers: [canView, kardexHandler(normalKardex)] } },
};

/** Producto sin movimientos: saldo y gráfico plano igualmente; el vacío va solo en la lista. */
export const Empty: Story = {
  parameters: { msw: { handlers: [canView, kardexHandler(emptyKardex)] } },
};

/** Más movimientos en 30 días que el tope del servidor: aviso y días antiguos sin dato. */
export const Truncated: Story = {
  parameters: { msw: { handlers: [canView, kardexHandler(truncatedKardex)] } },
};

/** El servidor falla: error con "Reintentar". */
export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [
        canView,
        http.get("/api/inventory/kardex", () =>
          HttpResponse.json(
            { error: { code: "INTERNAL_ERROR", message: "No se pudo consultar el kardex." } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
};

/** A 390 px: las cifras van en dos columnas y cada movimiento apila sus datos. */
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  parameters: {
    msw: { handlers: [canView, kardexHandler(normalKardex)] },
    viewport: {
      options: {
        mobile390: { name: "Móvil 390", styles: { height: "844px", width: "390px" } },
      },
    },
  },
};
