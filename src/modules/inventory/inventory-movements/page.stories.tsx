import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import type { ProductMock } from "@/shared/mocks/erp-data";

import type { InventoryMovement } from "../hooks/useInventory";
import { InventoryMovementsPage } from "./page";

/**
 * `/inventory/movements`: libro de movimientos con filtros aplicados por el
 * servidor (producto, tipo, tipo de documento, número de documento y rango de
 * fechas), documento de cada movimiento y saldo tras el movimiento.
 *
 * Las historias simulan `GET /api/inventory/movements`, `/api/products` y
 * `/api/auth/me` con MSW. Los filtros viven en la URL; la respuesta simulada
 * no los aplica.
 */
const meta = {
  component: InventoryMovementsPage,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/inventory/movements" },
    },
  },
  title: "Modules/Inventory/InventoryMovementsPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof InventoryMovementsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

function product(id: string, name: string, sku: string): ProductMock {
  return {
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock: 20,
    id,
    isActive: true,
    minStock: 5,
    name,
    salePriceRef: 2,
    sku,
  };
}

const harina = product("prod-harina", "Harina de maíz 1 kg", "HAR-001");
const aceite = product("prod-aceite", "Aceite vegetal 1 L", "ACE-003");
const refresco = product("prod-refresco", "Refresco 355 ml", "REF-010");

const movements: InventoryMovement[] = [
  {
    createdAt: "2026-10-05T16:20:00.000Z",
    documentKind: "venta",
    documentNumber: "V-0128",
    id: "mov-006",
    product: harina,
    productId: harina.id,
    quantityDelta: -2,
    reason: "Venta registrada en POS",
    saleId: "sale-128",
    stockAfter: 46,
    type: "venta",
  },
  {
    createdAt: "2026-10-05T13:05:00.000Z",
    documentKind: "compra",
    documentNumber: "C-0031",
    id: "mov-005",
    product: harina,
    productId: harina.id,
    purchaseId: "purchase-31",
    quantityDelta: 24,
    reason: "Recepción de compra",
    stockAfter: 48,
    type: "compra",
  },
  {
    conversionId: "conv-4",
    createdAt: "2026-10-04T18:45:00.000Z",
    documentKind: "conversion",
    documentNumber: null,
    id: "mov-004",
    product: refresco,
    productId: refresco.id,
    quantityDelta: 24,
    reason: "Apertura de bulto",
    stockAfter: 30,
    type: "conversion_entrada",
  },
  {
    createdAt: "2026-10-03T14:00:00.000Z",
    documentKind: null,
    documentNumber: null,
    id: "mov-003",
    product: aceite,
    productId: aceite.id,
    quantityDelta: -6,
    reason: "Conteo físico",
    stockAfter: -4,
    type: "ajuste_salida",
  },
  {
    createdAt: "2026-10-01T12:00:00.000Z",
    documentKind: null,
    documentNumber: null,
    id: "mov-002",
    product: aceite,
    productId: aceite.id,
    quantityDelta: 2,
    stockAfter: 2,
    type: "inventario_inicial",
  },
];

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

const catalog = [harina, aceite, refresco];

const productHandlers = [
  http.get("/api/products", ({ request }) => {
    const search = (new URL(request.url).searchParams.get("search") ?? "").toLowerCase();
    const items = catalog.filter(
      (item) => item.name.toLowerCase().includes(search) || item.sku.toLowerCase().includes(search),
    );

    return HttpResponse.json({ data: { items, limit: 8, skip: 0, total: items.length } });
  }),
  http.get("/api/products/:id", ({ params }) => {
    const found = catalog.find((item) => item.id === params.id);

    return found
      ? HttpResponse.json({ data: found })
      : HttpResponse.json(
          { error: { code: "NOT_FOUND", message: "Producto no encontrado." } },
          { status: 404 },
        );
  }),
  http.get("/api/inventory/pack-conversions", () => HttpResponse.json({ data: [] })),
];

function movementsHandler(items: InventoryMovement[], total = items.length) {
  return http.get("/api/inventory/movements", () =>
    HttpResponse.json({ data: { items, limit: 10, skip: 0, total } }),
  );
}

function handlers(role: "admin" | "almacen", items: InventoryMovement[], total?: number) {
  return [profileHandler(role), ...productHandlers, movementsHandler(items, total)];
}

/** Venta y compra con enlace, conversión de empaque, ajuste manual y un saldo negativo histórico. */
export const Default: Story = {
  parameters: { msw: { handlers: handlers("admin", movements, 45) } },
};

/** Estado leído de la URL: producto precargado por id, tipo, documento y rango. */
export const FiltersFromUrl: Story = {
  parameters: {
    msw: { handlers: handlers("admin", movements.slice(0, 1)) },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/inventory/movements",
        query: {
          document: "V-01",
          documentKind: "venta",
          from: "2026-10-01",
          productId: harina.id,
          to: "2026-10-05",
          type: "venta",
        },
      },
    },
  },
};

/** Con menos de 3 caracteres el número de documento no se envía y se muestra la ayuda. */
export const ShortDocument: Story = {
  parameters: {
    msw: { handlers: handlers("admin", movements) },
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/inventory/movements", query: { document: "V-" } },
    },
  },
};

/** `from` posterior a `to`: aviso junto a las fechas, sin consulta ni exportación. */
export const InvertedRange: Story = {
  parameters: {
    msw: { handlers: handlers("admin", movements) },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/inventory/movements",
        query: { from: "2026-10-05", to: "2026-10-01" },
      },
    },
  },
};

/** Llegando desde `/inventory`: "Volver" regresa a la lista tal como estaba. */
export const WithReturnTo: Story = {
  parameters: {
    msw: { handlers: handlers("admin", movements) },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/inventory/movements",
        query: { productId: aceite.id, returnTo: "/inventory?search=aceite&page=2" },
      },
    },
  },
};

/** Almacén: consulta y exporta, sin ajuste ni conversión. */
export const Warehouse: Story = {
  parameters: { msw: { handlers: handlers("almacen", movements) } },
};

/** Tienda sin movimientos. */
export const Empty: Story = {
  parameters: { msw: { handlers: handlers("admin", []) } },
};

/** Ningún movimiento coincide: se ofrece "Limpiar filtros". */
export const EmptyWithFilters: Story = {
  parameters: {
    msw: { handlers: handlers("admin", []) },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/inventory/movements",
        query: { documentKind: "sin_documento", type: "devolucion_cliente" },
      },
    },
  },
};

/** Fallo del servidor, con reintento. */
export const ServerError: Story = {
  parameters: {
    msw: {
      handlers: [
        profileHandler("admin"),
        ...productHandlers,
        http.get("/api/inventory/movements", () =>
          HttpResponse.json(
            { error: { code: "INTERNAL_ERROR", message: "No se pudo completar la solicitud." } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
};

/** El servidor niega la consulta. */
export const Forbidden: Story = {
  parameters: {
    msw: {
      handlers: [
        profileHandler("almacen"),
        ...productHandlers,
        http.get("/api/inventory/movements", () =>
          HttpResponse.json(
            { error: { code: "FORBIDDEN", message: "No tienes permiso para esta acción." } },
            { status: 403 },
          ),
        ),
      ],
    },
  },
};
