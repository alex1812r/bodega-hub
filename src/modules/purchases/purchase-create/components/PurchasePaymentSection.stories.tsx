import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PurchasePaymentSection } from "./PurchasePaymentSection";

const meta = {
  component: PurchasePaymentSection,
  title: "Modules/Purchases/PurchasePaymentSection",
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchasePaymentSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
