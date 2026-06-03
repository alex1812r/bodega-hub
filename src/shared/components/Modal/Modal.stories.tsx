import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { Button } from "../Button";
import { Modal } from "./Modal";

const meta = {
  component: Modal,
  tags: ["ai-generated"],
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: {
    title: "Registrar pago",
    description: "Confirma los datos antes de guardar el pago.",
    trigger: <Button>Abrir modal</Button>,
    children: (
      <p className="text-sm text-slate-600">
        Este modal se usara para formularios y confirmaciones del ERP.
      </p>
    ),
    footer: (
      <>
        <Button variant="outline">Cancelar</Button>
        <Button>Guardar</Button>
      </>
    ),
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /abrir modal/i }));

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole("dialog")).toBeVisible();
  },
};
