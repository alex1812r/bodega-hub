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
