import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";

import type { GlobalSearchResults } from "@/modules/search/types";

import { GlobalSearch } from "./GlobalSearch";

const results: GlobalSearchResults = {
  contacts: [
    { id: "cont-customer", name: "Ferretería La Central", taxId: "J-00000001-1", type: "cliente" },
  ],
  products: [
    { barcode: "7501234567890", id: "prod-drill", name: "Taladro percutor", sku: "her-tal-001" },
    { barcode: null, id: "prod-hostile", name: "<img src=x onerror=alert(1)>", sku: "xss-001" },
  ],
  purchases: [
    {
      createdAt: "2026-10-08T12:00:00Z",
      id: "purchase-001",
      number: "C-20261008-000002",
      status: "recibido",
      supplierName: "Suministros Industriales CA",
      totalRef: 20,
    },
  ],
  sales: [
    {
      createdAt: "2026-10-09T12:00:00Z",
      id: "sale-001",
      number: "V-20261009-000001",
      customerName: "Ferretería La Central",
      status: "pagada",
      totalRef: 15,
    },
  ],
};

const meta = {
  args: {
    permissions: ["products.view", "sales.view", "purchases.view", "contacts.view"],
  },
  component: GlobalSearch,
  decorators: [
    (Story) => (
      <header className="relative flex h-16 items-center gap-3 border-b border-outline-variant bg-surface px-4">
        <Story />
      </header>
    ),
  ],
  parameters: {
    msw: {
      handlers: [http.get("/api/search", () => HttpResponse.json({ data: results }))],
    },
  },
  tags: ["ai-generated"],
} satisfies Meta<typeof GlobalSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Escribe dos caracteres o más para ver los resultados agrupados; `/` enfoca el campo. */
export const Default: Story = {};

export const SinResultados: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/search", () =>
          HttpResponse.json({ data: { contacts: [], products: [], purchases: [], sales: [] } }),
        ),
      ],
    },
  },
};

export const Cargando: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/search", async () => {
          await delay("infinite");

          return HttpResponse.json({ data: results });
        }),
      ],
    },
  },
};

export const ConError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/search", () =>
          HttpResponse.json(
            { error: { code: "INTERNAL_ERROR", message: "Ocurrió un error inesperado." } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
};

/** Solo ve productos y compras: no hay grupos de ventas ni contactos. */
export const SoloAlmacen: Story = {
  args: {
    permissions: ["products.view", "purchases.view"],
  },
  parameters: {
    msw: {
      handlers: [
        http.get("/api/search", () =>
          HttpResponse.json({ data: { ...results, contacts: [], sales: [] } }),
        ),
      ],
    },
  },
};

/** 390 px: lupa que abre el buscador a ancho completo sobre el header. */
export const Movil: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "390 px: lupa",
  parameters: {
    viewport: {
      options: {
        mobile390: {
          name: "Móvil 390 px",
          styles: { height: "844px", width: "390px" },
          type: "mobile",
        },
      },
    },
  },
};

/** Sin ningún permiso de búsqueda no se muestra. */
export const SinPermisos: Story = {
  args: {
    permissions: ["dashboard.view"],
  },
};
