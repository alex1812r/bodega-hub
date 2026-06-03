import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ProductFormModal } from "./ProductFormModal";

const meta = {
  component: ProductFormModal,
  tags: ["ai-generated"],
} satisfies Meta<typeof ProductFormModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {};

export const Edit: Story = {
  args: {
    mode: "edit",
  },
};
