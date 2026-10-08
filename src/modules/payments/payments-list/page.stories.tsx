import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PaymentsListPage } from "./page";

/**
 * Lista de pagos. Filtros, página y tamaño viven en la URL (`useUrlListState`):
 * `from`/`to` (día operativo Caracas), `method`, `direction`, `page`, `limit`.
 * `saleId`, `purchaseId` y `contactId` llegan por enlace desde otras pantallas y
 * se muestran como chips quitables, nunca como campos.
 */
const meta = {
  component: PaymentsListPage,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/payments" },
    },
  },
  title: "Modules/Payments/PaymentsListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof PaymentsListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FilteredByMethodAndDates: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/payments",
        query: { from: "2026-05-14", method: "transferencia", to: "2026-05-18" },
      },
    },
  },
};

export const DeepLinkedFromSale: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/payments",
        query: { saleId: "sale-002" },
      },
    },
  },
};
