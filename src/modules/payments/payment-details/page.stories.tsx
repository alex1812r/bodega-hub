import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PaymentDetailsPage } from "./page";

const meta = {
  component: PaymentDetailsPage,
  title: "Modules/Payments/PaymentDetailsPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof PaymentDetailsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
