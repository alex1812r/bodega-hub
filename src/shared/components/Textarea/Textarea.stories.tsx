import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Textarea } from "./Textarea";

const meta = {
  component: Textarea,
  tags: ["ai-generated"],
  args: {
    label: "Notas",
    placeholder: "Agrega detalles adicionales",
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHelper: Story = {
  args: {
    helperText: "Este campo es opcional.",
  },
};
