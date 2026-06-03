import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ProductDetailsPage } from "./page";

const meta = {
  component: ProductDetailsPage,
  title: "Modules/Products/ProductDetailsPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof ProductDetailsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
