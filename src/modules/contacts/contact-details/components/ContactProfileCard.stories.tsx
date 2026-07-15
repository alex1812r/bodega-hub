import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ContactProfileCard } from "./ContactProfileCard";

const meta = {
  component: ContactProfileCard,
  tags: ["ai-generated"],
  args: {
    contact: {
      address: "Av. Principal, Caracas",
      email: "maria@email.com",
      id: "cont-1",
      isActive: true,
      name: "Maria Perez",
      phone: "0412-0000000",
      taxId: "V-12345678",
      type: "cliente",
    },
  },
} satisfies Meta<typeof ContactProfileCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Customer: Story = {};

export const Supplier: Story = {
  args: {
    contact: {
      address: "Zona industrial",
      email: "ventas@central.com",
      id: "cont-2",
      isActive: true,
      name: "Distribuidora Central",
      phone: "0212-1111111",
      taxId: "J-12345678-9",
      type: "proveedor",
    },
  },
};
