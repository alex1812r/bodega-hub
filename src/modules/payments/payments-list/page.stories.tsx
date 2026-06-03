import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PaymentsListPage } from "./page";

const meta = {
  component: PaymentsListPage,
  title: "Modules/Payments/PaymentsListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof PaymentsListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
