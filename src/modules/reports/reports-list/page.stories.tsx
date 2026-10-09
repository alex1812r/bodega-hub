import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import MockDate from "mockdate";

import { ReportsListPage } from "./page";

/**
 * `/reports`: catálogo agrupado (Ventas · Compras · Inventario · Dinero) con
 * búsqueda, un solo rango de fechas (`DateRangeField`), agrupación y comparación
 * en los reportes de serie, y el resultado del reporte activo: gráfico encima
 * (línea en los de serie, barras ordenadas en los de ranking) y la tabla debajo,
 * plegable.
 *
 * Todo el estado vive en la URL (`report`, `from`, `to`, `preset`, `groupBy`,
 * `compare`, `supplierId`, `productId`, `page`, `limit`): cada historia es un
 * enlace distinto a la misma pantalla.
 */
const meta = {
  // Los datos de prueba son de mayo de 2026: con el "hoy" en su último día los
  // rangos relativos («últimos 30 días», «este mes») traen datos y hay gráfico.
  beforeEach() {
    MockDate.set("2026-05-18T16:00:00.000Z");
  },
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

/** Sin parámetros: ventas diarias de los últimos 30 días (rango por defecto, fuera de la URL). */
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

/** Ranking: barras horizontales con el top de la página visible, encima de la tabla. */
export const Ranking: Story = {
  parameters: {
    nextjs: {
      navigation: { pathname: "/reports", query: { preset: "this_month", report: "top-customers" } },
    },
  },
};

/** Métodos de pago comparados con el periodo anterior: barra y variación por método. */
export const PaymentMethodsWithCompare: Story = {
  parameters: {
    nextjs: {
      navigation: {
        pathname: "/reports",
        query: { compare: "1", preset: "last_30_days", report: "payment-methods" },
      },
    },
  },
};

/** «Todas las fechas» elegido a propósito: el gráfico de línea pide un rango y la tabla sigue. */
export const AllDates: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/reports", query: { preset: "custom" } } },
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

/** 390 px: catálogo plegado, gráfico a la vista y tabla plegada debajo. */
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
