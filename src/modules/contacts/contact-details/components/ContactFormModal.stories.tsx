import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ContactFormModal } from "./ContactFormModal";

const meta = {
  component: ContactFormModal,
  tags: ["ai-generated"],
} satisfies Meta<typeof ContactFormModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {};

export const Edit: Story = {
  args: {
    contact: {
      address: "Av. Principal, Caracas",
      email: "cliente@example.com",
      id: "cont-customer",
      isActive: true,
      name: "Ferreteria La Central",
      phone: "0412-0000001",
      taxId: "J-00000001-1",
      type: "cliente",
    },
    mode: "edit",
  },
};
