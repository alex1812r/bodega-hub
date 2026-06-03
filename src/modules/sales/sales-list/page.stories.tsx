import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SalesListPage } from "./page";

const meta = {
  component: SalesListPage,
  title: "Modules/Sales/SalesListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof SalesListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
