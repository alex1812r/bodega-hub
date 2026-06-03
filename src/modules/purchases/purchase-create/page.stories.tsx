import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PurchaseCreatePage } from "./page";

const meta = {
  component: PurchaseCreatePage,
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchaseCreatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
