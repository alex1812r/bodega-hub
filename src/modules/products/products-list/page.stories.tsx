import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ProductsListPage } from "./page";

const meta = {
  component: ProductsListPage,
  title: "Modules/Products/ProductsListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof ProductsListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
