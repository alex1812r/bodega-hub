import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PurchaseTotalsCard } from "./PurchaseTotalsCard";

const meta = {
  component: PurchaseTotalsCard,
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchaseTotalsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
