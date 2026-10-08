import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { mockCategories, mockProducts } from "@/shared/mocks/erp-data";

import { ProductFormModal } from "./ProductFormModal";

const meta = {
  component: ProductFormModal,
  tags: ["ai-generated"],
  args: {
    categories: mockCategories,
    open: true,
  },
} satisfies Meta<typeof ProductFormModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Alta: solo el nivel básico a la vista; "Más opciones" cerrada. Con permiso
 * para gestionar productos, bajo Categoría aparece "+ Nueva categoría". El pie
 * ofrece "Guardar y crear otro" (solo en el alta completa).
 */
export const Create: Story = {};

/** Edición: "Más opciones" cerrada, con el SKU y el stock actual en el resumen. */
export const Edit: Story = {
  args: {
    mode: "edit",
    product: mockProducts[0],
  },
};

/** Alta rápida para Compras (COM-03) y el surtido (PRO-13), precargada con lo escaneado. */
export const Compact: Story = {
  args: {
    compact: true,
    initialValues: {
      barcode: "7591234567890",
      categoryId: mockCategories[0]?.id,
      currentCostRef: 1.5,
      name: "Harina PAN 1 kg",
    },
  },
};

/** El modal vive en un portal: se busca en el documento, no en el lienzo. */
export const MoreOptionsOpen: Story = {
  play: async () => {
    const toggle = await screen.findByRole("button", { name: /más opciones/i });

    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // El contenido entra con un fundido de 200 ms: se espera a que termine.
    await waitFor(() => expect(screen.getByLabelText("SKU")).toBeVisible());
    // El SKU es opcional: su ayuda dice que vacío lo genera el servidor.
    await expect(screen.getByText(/Si lo dejas vacío se genera solo\./)).toBeVisible();
  },
};
