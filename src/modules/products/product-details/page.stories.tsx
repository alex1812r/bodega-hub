import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ProductDetailsPage } from "./page";

const meta = {
  component: ProductDetailsPage,
  title: "Modules/Products/ProductDetailsPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof ProductDetailsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const DETAIL_PATH = "/products/prod-drill";

/** Sin `?tab=`: abre en Resumen (información, stock y precio; el kardex, plegado). */
export const Default: Story = {
  parameters: { nextjs: { navigation: { pathname: DETAIL_PATH } } },
};

export const Proveedores: Story = {
  parameters: { nextjs: { navigation: { pathname: DETAIL_PATH, query: { tab: "proveedores" } } } },
};

/** Historial de precios y de ventas, cada uno con su paginación en la URL. */
export const Historial: Story = {
  parameters: { nextjs: { navigation: { pathname: DETAIL_PATH, query: { tab: "historial" } } } },
};

/** Conversión de empaque e imagen. */
export const Avanzado: Story = {
  parameters: { nextjs: { navigation: { pathname: DETAIL_PATH, query: { tab: "avanzado" } } } },
};
