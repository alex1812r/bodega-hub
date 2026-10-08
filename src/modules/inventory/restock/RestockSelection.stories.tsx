import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import type { InventoryOverviewItem } from "../services/inventoryOverview";
import type { RestockSupplierLink } from "./restockPlan";
import { RestockSelection } from "./RestockSelection";

/**
 * Reposición (INV-05): productos con stock bajo o agotado, con casilla,
 * cantidad sugerida editable (mínimo × 2 − stock, entero ≥ 1) y proveedor
 * resuelto al seleccionarlos. El resumen reparte la selección por proveedor:
 * una compra es de un solo proveedor, así que con varios se elige con cuál
 * crear la compra ahora. "Crear compra con estos productos" guarda la precarga
 * y navega a `/purchases/create?restock=<id>`.
 *
 * En la app se abre con `RestockPurchaseButton` (botón + modal, solo con
 * `purchases.create`). Estas historias simulan `GET /api/auth/me`,
 * `GET /api/inventory` y `GET /api/products/{id}/suppliers` con MSW.
 */
const meta = {
  component: RestockSelection,
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl bg-surface-container-lowest p-4">
        <Story />
      </div>
    ),
  ],
  tags: ["ai-generated"],
  title: "Modules/Inventory/RestockSelection",
} satisfies Meta<typeof RestockSelection>;

export default meta;
type Story = StoryObj<typeof meta>;

const currentUserHandler = http.get("/api/auth/me", () => {
  const permissions = ["inventory.view", "products.view", "purchases.create", "purchases.view"];

  return HttpResponse.json({
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
  });
});

function item(
  id: string,
  name: string,
  currentStock: number,
  minStock: number,
): InventoryOverviewItem {
  return {
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock,
    entries30d: 0,
    exits30d: 0,
    id,
    isActive: true,
    lastMovementAt: null,
    lastMovementType: null,
    minStock,
    name,
    salePriceRef: 2,
    sku: id.toUpperCase(),
    stockStatus: currentStock === 0 ? "out" : "low",
  };
}

const ITEMS = [
  item("prod-arroz", "Arroz blanco 1 kg", 2, 5),
  item("prod-aceite", "Aceite de girasol 1 L", -3, 5),
  item("prod-cafe", "Café molido 500 g", 0, 4),
  item("prod-sal", "Sal refinada 1 kg", 0, 0),
  item(
    "prod-largo",
    "Detergente líquido concentrado para ropa blanca y de color, botella de 3 litros",
    1,
    12,
  ),
];

/** 120 productos por reponer: la lista llega de 50 en 50. */
const MANY_ITEMS = Array.from({ length: 120 }, (_, index) =>
  item(`prod-${index + 1}`, `Producto ${String(index + 1).padStart(3, "0")}`, index % 4, 6),
);

function link(
  supplierId: string,
  name: string,
  overrides: Partial<RestockSupplierLink> = {},
): RestockSupplierLink {
  return {
    isActive: true,
    isPreferred: false,
    lastCostRef: 0,
    supplier: { id: supplierId, isActive: true, name },
    supplierId,
    ...overrides,
  };
}

const ALFA = link("sup-alfa", "Distribuidora Alfa", { isPreferred: true, lastCostRef: 1.25 });
const BETA = link("sup-beta", "Mayorista Beta", { lastPurchasedAt: "2024-03-20T14:00:00.000Z" });

const LINKS: Record<string, RestockSupplierLink[]> = {
  "prod-aceite": [BETA],
  "prod-arroz": [ALFA, BETA],
  "prod-cafe": [ALFA],
  "prod-largo": [BETA],
  "prod-sal": [],
};

function inventoryHandler(items: InventoryOverviewItem[]) {
  return http.get("/api/inventory", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const skip = Number(params.get("skip") ?? 0);
    const limit = Number(params.get("limit") ?? 50);

    return HttpResponse.json({
      data: { items: items.slice(skip, skip + limit), limit, skip, total: items.length },
    });
  });
}

const suppliersHandler = http.get("/api/products/:id/suppliers", ({ params }) => {
  const items = LINKS[String(params.id)] ?? [ALFA];

  return HttpResponse.json({ data: { items, limit: 100, skip: 0, total: items.length } });
});

/** Cinco productos de dos proveedores y uno sin proveedor: al seleccionar todos hay que elegir grupo. */
export const Default: Story = {
  parameters: {
    msw: { handlers: [currentUserHandler, inventoryHandler(ITEMS), suppliersHandler] },
  },
};

/** Más productos de los que se muestran: se dice cuántos hay y se cargan más a demanda. */
export const MasDeUnaPagina: Story = {
  parameters: {
    msw: { handlers: [currentUserHandler, inventoryHandler(MANY_ITEMS), suppliersHandler] },
  },
};

export const Vacio: Story = {
  parameters: {
    msw: { handlers: [currentUserHandler, inventoryHandler([]), suppliersHandler] },
  },
};

/** La consulta del proveedor falla: el producto no entra en ninguna compra hasta reintentar. */
export const ProveedorConError: Story = {
  parameters: {
    msw: {
      handlers: [
        currentUserHandler,
        inventoryHandler(ITEMS),
        http.get("/api/products/:id/suppliers", () =>
          HttpResponse.json({ error: { code: "INTERNAL", message: "Fallo" } }, { status: 500 }),
        ),
      ],
    },
  },
};

export const ErrorAlCargar: Story = {
  parameters: {
    msw: {
      handlers: [
        currentUserHandler,
        http.get("/api/inventory", () =>
          HttpResponse.json({ error: { code: "INTERNAL", message: "Fallo" } }, { status: 500 }),
        ),
      ],
    },
  },
};

/** Puede crear compras pero no consultar el inventario (permiso retirado por el admin). */
export const SinPermisoDeInventario: Story = {
  parameters: {
    msw: {
      handlers: [
        currentUserHandler,
        http.get("/api/inventory", () =>
          HttpResponse.json(
            { error: { code: "FORBIDDEN", message: "No tienes permiso." } },
            { status: 403 },
          ),
        ),
      ],
    },
  },
};
