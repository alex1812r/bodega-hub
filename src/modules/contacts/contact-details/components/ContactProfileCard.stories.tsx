import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ContactProfileCard } from "./ContactProfileCard";

const meta = {
  component: ContactProfileCard,
  tags: ["ai-generated"],
  args: {
    contact: {
      name: "Maria Perez",
      type: "cliente",
      phone: "0412-0000000",
      email: "maria@email.com",
      taxId: "V-12345678",
      address: "Av. Principal, Caracas",
    },
  },
} satisfies Meta<typeof ContactProfileCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Customer: Story = {};

export const Supplier: Story = {
  args: {
    contact: {
      name: "Distribuidora Central",
      type: "proveedor",
      phone: "0212-1111111",
      email: "ventas@central.com",
      taxId: "J-12345678-9",
      address: "Zona industrial",
    },
  },
};
