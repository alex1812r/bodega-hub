import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PurchasesListPage } from "./page";

const meta = {
  component: PurchasesListPage,
  title: "Modules/Purchases/PurchasesListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchasesListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
