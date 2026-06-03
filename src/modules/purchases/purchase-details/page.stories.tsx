import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PurchaseDetailsPage } from "./page";

const meta = {
  component: PurchaseDetailsPage,
  tags: ["ai-generated"],
  title: "Modules/Purchases/PurchaseDetailsPage",
} satisfies Meta<typeof PurchaseDetailsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
