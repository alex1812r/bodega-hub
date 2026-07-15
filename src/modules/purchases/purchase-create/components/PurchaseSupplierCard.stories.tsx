import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PurchaseSupplierCard } from "./PurchaseSupplierCard";

const meta = {
  component: PurchaseSupplierCard,
  title: "Modules/Purchases/PurchaseSupplierCard",
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchaseSupplierCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onSupplierChange: () => undefined,
    selectedSupplierId: "",
    suppliers: [
      {
        address: "Caracas",
        email: "ventas@norte.test",
        id: "sup-1",
        isActive: true,
        name: "Distribuidora Norte C.A.",
        phone: "0412-0000000",
        taxId: "J-12345678-9",
        type: "proveedor",
      },
    ],
  },
};
