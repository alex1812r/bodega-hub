import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SaleDetailsPage } from "./page";

const meta = {
  component: SaleDetailsPage,
  title: "Modules/Sales/SaleDetailsPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof SaleDetailsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
