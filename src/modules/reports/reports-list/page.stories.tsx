import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ReportsListPage } from "./page";

/**
 * `/reports`: catálogo agrupado (Ventas · Compras · Inventario · Dinero) con
 * búsqueda, un solo rango de fechas (`DateRangeField`), agrupación y comparación
 * en los reportes de serie, y el resultado del reporte activo.
 *
 * Todo el estado vive en la URL (`report`, `from`, `to`, `preset`, `groupBy`,
 * `compare`, `supplierId`, `productId`, `page`, `limit`): cada historia es un
 * enlace distinto a la misma pantalla.
 */
const meta = {
  component: ReportsListPage,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/reports" },
    },
  },
  title: "Modules/Reports/ReportsListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof ReportsListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sin parámetros: ventas diarias, todas las fechas, catálogo plegado. */
export const Default: Story = {};

/** Reporte de serie con rango relativo, agrupado por semana y comparado con el periodo anterior. */
export const SeriesWithCompare: Story = {
  parameters: {
    nextjs: {
      navigation: {
        pathname: "/reports",
        query: { compare: "1", groupBy: "week", preset: "last_30_days", report: "gross-profit" },
      },
    },
  },
};

/** Reporte que no usa fechas: el rango se ve deshabilitado con su aviso. */
export const WithoutDateRange: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/reports", query: { report: "low-stock" } } },
  },
};

/** Compras: rango personalizado y buscador de proveedor. */
export const PurchasesBySupplier: Story = {
  parameters: {
    nextjs: {
      navigation: {
        pathname: "/reports",
        query: { from: "2026-05-01", report: "purchases", to: "2026-05-18" },
      },
    },
  },
};

/** Métodos de pago con el rango global (sin selector de fechas propio). */
export const PaymentMethodsToday: Story = {
  parameters: {
    nextjs: {
      navigation: { pathname: "/reports", query: { preset: "today", report: "payment-methods" } },
    },
  },
};

/** 390 px: el catálogo plegado deja filtros y resultado en la primera pantalla. */
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "390 px: catálogo plegado",
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
