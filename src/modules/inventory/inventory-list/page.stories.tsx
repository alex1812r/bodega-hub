import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import type { CategoryMock, StockMovementType } from "@/shared/mocks/erp-data";

import type { InventoryMovement } from "../hooks/useInventory";
import type { InventoryOverviewItem } from "../services/inventoryOverview";
import { InventoryListPage } from "./page";

/**
 * `/inventory` como vista única de stock: stock, mínimo, entradas y salidas de
 * 30 días, último movimiento y estado. Para admin, el aviso "Descuadre" cuando
 * el stock no coincide con la suma de movimientos.
 *
 * Cada fila se expande con sus últimos movimientos; el producto abierto vive en
 * `?product=<id>` y, si no está en la página, se fija encima de la tabla.
 *
 * Las historias simulan `GET /api/inventory`, `/api/inventory/movements`,
 * `/api/categories` y `/api/auth/me` con MSW. Los filtros viven en la URL; la
 * respuesta simulada no los aplica.
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

/** La página de la lista; con `productId`, el producto de `byId` que tenga ese id (o ninguno). */
function inventoryHandler(items: InventoryOverviewItem[], byId: InventoryOverviewItem[] = []) {
  return http.get("/api/inventory", ({ request }) => {
    const productId = new URL(request.url).searchParams.get("productId");
    const found = productId === null ? items : byId.filter((row) => row.id === productId);

    return HttpResponse.json({ data: { items: found, limit: 10, skip: 0, total: found.length } });
  });
}

function movement(overrides: Partial<InventoryMovement>): InventoryMovement {
  return {
    createdAt: "2024-03-29T13:05:00.000Z",
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
    documentKind: "compra",
    documentNumber: "C-000045",
    id: "mov-3",
    purchaseId: "purchase-45",
    quantityDelta: 24,
    stockAfter: 9,
    type: "compra",
  }),
  movement({
    createdAt: "2024-03-27T19:40:00.000Z",
    id: "mov-2",
    quantityDelta: -2,
    reason: "Conteo físico: dos bolsas rotas",
    stockAfter: -15,
    type: "ajuste_salida",
  }),
  movement({
    createdAt: "2024-03-20T12:00:00.000Z",
    documentKind: "venta",
    documentNumber: "V-000198",
    id: "mov-1",
    quantityDelta: -13,
    saleId: "sale-198",
    stockAfter: -13,
    type: "venta",
  }),
];

const movementsHandler = http.get("/api/inventory/movements", () =>
  HttpResponse.json({ data: { items: movements, limit: 10, skip: 0, total: movements.length } }),
);

/** Producto activo que no está en la página de la lista. */
const offPageItem = item("caf-006", "Café molido 500 g", {
  currentStock: 7,
  entries30d: 12,
  exits30d: 5,
  lastMovementAt: "2024-03-28T16:30:00.000Z",
  lastMovementType: "compra",
  minStock: 9,
  reconciliationDiff: 2,
});

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

/**
 * `/inventory?product=arr-002`: la fila de "Arroz blanco" llega expandida con
 * sus últimos movimientos, el saldo tras cada uno y la línea del descuadre.
 */
export const ExpandedRow: Story = {
  parameters: {
    msw: {
      handlers: [
        profileHandler("admin"),
        categoriesHandler,
        packConversionsHandler,
        inventoryHandler(adminItems),
        movementsHandler,
      ],
    },
    nextjs: { navigation: { pathname: "/inventory", query: { product: "arr-002" } } },
  },
};

/**
 * `/inventory?product=caf-006` (enlace desde Productos): el producto no está en
 * la página, así que se fija encima de la tabla con sus movimientos abiertos.
 */
export const SelectedProductPinned: Story = {
  parameters: {
    msw: {
      handlers: [
        profileHandler("admin"),
        categoriesHandler,
        packConversionsHandler,
        inventoryHandler(adminItems, [offPageItem]),
        movementsHandler,
      ],
    },
    nextjs: { navigation: { pathname: "/inventory", query: { product: "caf-006" } } },
  },
};

/** El producto de la URL no existe, está inactivo o es de otra tienda: aviso y la lista sigue. */
export const SelectedProductNotFound: Story = {
  parameters: {
    msw: {
      handlers: [
        profileHandler("admin"),
        categoriesHandler,
        packConversionsHandler,
        inventoryHandler(adminItems),
      ],
    },
    nextjs: { navigation: { pathname: "/inventory", query: { product: "no-existe" } } },
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
