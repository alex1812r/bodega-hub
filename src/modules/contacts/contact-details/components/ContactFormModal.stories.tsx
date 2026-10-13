import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent } from "storybook/test";

import { ContactFormModal } from "./ContactFormModal";

const meta = {
  component: ContactFormModal,
  tags: ["ai-generated"],
} satisfies Meta<typeof ContactFormModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Alta: el pie ofrece "Guardar y crear otro", que deja el modal abierto con el mismo Tipo. */
export const Create: Story = {};

/** Edición: solo "Guardar cambios". */
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

/**
 * CNF-15: con cambios sin guardar, Esc (o clic fuera, Cancelar, la X) no cierra:
 * pregunta con el guardia de proceso, que nombra el contacto. Sin cambios cierra directo.
 * El modal vive en un portal: se busca en el documento, no en el lienzo.
 */
export const UnsavedChangesGuard: Story = {
  args: { open: true },
  play: async () => {
    await userEvent.type(await screen.findByLabelText("Nombre"), "Distribuidora X");
    await userEvent.keyboard("{Escape}");

    await expect(
      await screen.findByRole("dialog", { name: "¿Salir sin terminar?" }),
    ).toHaveTextContent("Contacto nuevo «Distribuidora X» sin guardar");
  },
};
