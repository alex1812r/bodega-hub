import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { mockCategories } from "@/shared/mocks/erp-data";

import { CategoryFormModal } from "./CategoryFormModal";

const meta = {
  component: CategoryFormModal,
  tags: ["ai-generated"],
  args: {
    open: true,
  },
} satisfies Meta<typeof CategoryFormModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Alta: la alícuota de IVA abre en la que la tienda tiene por defecto; no se teclea. */
export const Create: Story = {};

/** Edición: el chip muestra la alícuota de la categoría. */
export const Edit: Story = {
  args: {
    category: mockCategories[0],
    mode: "edit",
  },
};

/** Una alícuota que ya no está en el catálogo se muestra con su % y se conserva al guardar. */
export const EditWithRetiredTaxRate: Story = {
  args: {
    category: { ...mockCategories[0], taxRate: 12.5, taxRateId: "tax-retirada" },
    mode: "edit",
  },
};

export const WithServerError: Story = {
  args: {
    errorMessage: "Ya existe una categoría con ese nombre.",
  },
};
