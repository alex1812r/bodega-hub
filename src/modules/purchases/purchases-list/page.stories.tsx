import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PurchasesListPage } from "./page";

/**
 * Lista de compras con lo pagado, el saldo y el estado de pago de cada una.
 * Búsqueda, filtros, página y tamaño viven en la URL (`useUrlListState`):
 * `search`, `status`, `pendingBalance=1` ("Con saldo pendiente"), `from`/`to`
 * (día operativo Caracas), `page`, `limit`. «Ver detalle» lleva `returnTo`.
 *
 * El número de compra es el enlace al detalle. Las columnas siguen el ancho de la
 * tarjeta de la tabla (`@container`): Fecha aparece desde 1152 px (antes va bajo
 * el número) y Pagado desde 1280 px; Acciones se ve siempre. En un pedido,
 * «Recibir mercancía…» no recibe: abre el detalle con la previsualización.
 */
const meta = {
  component: PurchasesListPage,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/purchases" },
    },
  },
  title: "Modules/Purchases/PurchasesListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchasesListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** "¿Qué compras debo?": un filtro y el saldo pendiente de todo lo filtrado. */
export const WithPendingBalance: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/purchases",
        query: { pendingBalance: "1" },
      },
    },
  },
};

export const FilteredByDates: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/purchases",
        query: { from: "2026-05-16", to: "2026-05-17" },
      },
    },
  },
};
