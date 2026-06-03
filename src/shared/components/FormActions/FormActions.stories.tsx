import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { FormActions } from "./FormActions";

const meta = {
  component: FormActions,
  tags: ["ai-generated"],
  args: {
    onCancel: fn(),
  },
} satisfies Meta<typeof FormActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Submitting: Story = {
  args: {
    isSubmitting: true,
  },
};

export const SavingModal: Story = {
  args: {
    isSubmitting: true,
    submitLabel: "Guardar",
    submittingLabel: "Guardando cambios...",
  },
};
