import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ReportsListPage } from "./page";

const meta = {
  component: ReportsListPage,
  title: "Modules/Reports/ReportsListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof ReportsListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
