import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CategoriesListPage } from "./page";

const meta = {
  component: CategoriesListPage,
  title: "Modules/Products/CategoriesListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof CategoriesListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
