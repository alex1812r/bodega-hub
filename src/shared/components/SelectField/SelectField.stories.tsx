import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SelectField } from "./SelectField";

const meta = {
  component: SelectField,
  tags: ["ai-generated"],
  args: {
    label: "Estado",
    options: [
      { label: "Activo", value: "activo" },
      { label: "Inactivo", value: "inactivo" },
    ],
    placeholder: "Selecciona un estado",
  },
} satisfies Meta<typeof SelectField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithError: Story = {
  args: {
    error: "Selecciona una opcion.",
  },
};
