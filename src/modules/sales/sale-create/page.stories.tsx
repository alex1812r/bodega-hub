import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SaleCreatePage } from "./page";

const meta = {
  component: SaleCreatePage,
  title: "Modules/Sales/SaleCreatePage",
  tags: ["ai-generated"],
} satisfies Meta<typeof SaleCreatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
