import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import type { CategoryMock, StockMovementType } from "@/shared/mocks/erp-data";

import type { InventoryOverviewItem } from "../services/inventoryOverview";
import { InventoryListPage } from "./page";

/**
 * `/inventory` como vista única de stock: stock, mínimo, entradas y salidas de
 * 30 días, último movimiento y estado. Para admin, el aviso "Descuadre" cuando
 * el stock no coincide con la suma de movimientos.
 *
 * Las historias simulan `GET /api/inventory`, `/api/categories` y
 * `/api/auth/me` con MSW. Los filtros viven en la URL; la respuesta simulada
 * no los aplica.
 */
const meta = {
  component: InventoryListPage,
  title: "Modules/Inventory/InventoryListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof InventoryListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const categories: CategoryMock[] = Array.from({ length: 12 }, (_, index) => ({
  id: `cat-${index + 1}`,
  isActive: true,
  name: `Categoría ${String(index + 1).padStart(2, "0")}`,
  taxRate: 16,
}));

function item(
  id: string,
  name: string,
  figures: {
    currentStock: number;
    entries30d?: number;
    exits30d?: number;
    lastMovementAt?: string;
    lastMovementType?: StockMovementType;
    minStock: number;
    reconciliationDiff?: number | null;
  },
): InventoryOverviewItem {
  const { currentStock, minStock } = figures;

  return {
    category: categories[0],
    categoryId: categories[0].id,
    currentCostRef: 1,
    currentStock,
    entries30d: figures.entries30d ?? 0,
    exits30d: figures.exits30d ?? 0,
    id,
    isActive: true,
    lastMovementAt: figures.lastMovementAt ?? null,
    lastMovementType: figures.lastMovementType ?? null,
    minStock,
    name,
    reconciliationDiff: figures.reconciliationDiff ?? null,
    salePriceRef: 2,
    sku: id.toUpperCase(),
    stockStatus: currentStock === 0 ? "out" : currentStock <= minStock ? "low" : "ok",
  };
}

const adminItems: InventoryOverviewItem[] = [
  item("har-001", "Harina de maíz 1 kg", {
    currentStock: 48,
    entries30d: 120,
    exits30d: 96,
    lastMovementAt: "2024-03-31T15:20:00.000Z",
    lastMovementType: "venta",
    minStock: 12,
  }),
  item("arr-002", "Arroz blanco 1 kg", {
    currentStock: 9,
    entries30d: 24,
    exits30d: 31,
    lastMovementAt: "2024-03-29T13:05:00.000Z",
    lastMovementType: "compra",
    minStock: 10,
    reconciliationDiff: 3,
  }),
  item("ace-003", "Aceite vegetal 1 L", {
    currentStock: -4,
    entries30d: 0,
    exits30d: 16,
    lastMovementAt: "2024-03-30T18:45:00.000Z",
    lastMovementType: "venta",
    minStock: 6,
    reconciliationDiff: -2,
  }),
  item("azu-004", "Azúcar refinada 1 kg", {
    currentStock: 0,
    entries30d: 10,
    exits30d: 10,
    lastMovementAt: "2024-03-12T14:00:00.000Z",
    lastMovementType: "ajuste_salida",
    minStock: 8,
  }),
  item("sal-005", "Sal marina 500 g", { currentStock: 30, minStock: 5 }),
];

function withoutReconciliation(row: InventoryOverviewItem): InventoryOverviewItem {
  const copy = { ...row };

  delete copy.reconciliationDiff;

  return copy;
}

function profileHandler(role: "admin" | "almacen") {
  return http.get("/api/auth/me", () =>
    HttpResponse.json({
      data: {
        deniedPermissions: [],
        grantedPermissions: [],
        permissionCatalog: [],
        permissions:
          role === "admin" ? ["inventory.view", "inventory.manage"] : ["inventory.view"],
        role,
        roles: [],
        user: { email: `${role}@bodegahub.test`, id: `user-${role}`, isActive: true, name: role },
      },
    }),
  );
}

const categoriesHandler = http.get("/api/categories", () =>
  HttpResponse.json({
    data: { items: categories, limit: 100, skip: 0, total: categories.length },
  }),
);

const packConversionsHandler = http.get("/api/inventory/pack-conversions", () =>
  HttpResponse.json({ data: [] }),
);

function inventoryHandler(items: InventoryOverviewItem[]) {
  return http.get("/api/inventory", () =>
    HttpResponse.json({ data: { items, limit: 10, skip: 0, total: items.length } }),
  );
}

/** Admin: columnas nuevas, un descuadre de +3, un stock negativo con descuadre de −2 y un producto sin movimientos. */
export const Default: Story = {
  parameters: {
    msw: {
      handlers: [
        profileHandler("admin"),
        categoriesHandler,
        packConversionsHandler,
        inventoryHandler(adminItems),
      ],
    },
  },
};

/** Almacén: mismas filas sin el aviso de descuadre (el campo no llega) ni acciones de ajuste. */
export const Warehouse: Story = {
  parameters: {
    msw: {
      handlers: [
        profileHandler("almacen"),
        categoriesHandler,
        packConversionsHandler,
        inventoryHandler(adminItems.map(withoutReconciliation)),
      ],
    },
  },
};

/** Tienda sin productos. */
export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [profileHandler("admin"), categoriesHandler, packConversionsHandler, inventoryHandler([])],
    },
  },
};

/** El servidor niega la consulta. */
export const Forbidden: Story = {
  parameters: {
    msw: {
      handlers: [
        profileHandler("almacen"),
        categoriesHandler,
        packConversionsHandler,
        http.get("/api/inventory", () =>
          HttpResponse.json(
            { error: { code: "FORBIDDEN", message: "No tienes permiso para esta acción." } },
            { status: 403 },
          ),
        ),
      ],
    },
  },
};
