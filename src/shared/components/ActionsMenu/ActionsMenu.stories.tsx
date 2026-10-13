import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { ActionsMenu } from "./ActionsMenu";

const meta = {
  component: ActionsMenu,
  tags: ["ai-generated"],
  args: {
    actions: [
      { label: "Ver detalle", onSelect: fn() },
      { label: "Editar", onSelect: fn() },
      { label: "Eliminar", onSelect: fn(), variant: "danger" },
    ],
  },
} satisfies Meta<typeof ActionsMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * Disparador pegado al borde inferior derecho de la ventana (última fila de una
 * lista): el menú se abre hacia arriba y queda entero a la vista.
 */
export const AtViewportBottom: Story = {
  args: {
    actions: [
      { label: "Ver detalle", onSelect: fn() },
      { label: "Ver recibo", onSelect: fn() },
      { label: "Anular", onSelect: fn(), variant: "danger" },
      { label: "Devolver", onSelect: fn() },
    ],
  },
  decorators: [
    (Story) => (
      <div className="fixed bottom-2 right-2">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "fullscreen" },
};
