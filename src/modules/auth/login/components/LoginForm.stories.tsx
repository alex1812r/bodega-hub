import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { LoginForm } from "./LoginForm";

const meta = {
  component: LoginForm,
  tags: ["ai-generated"],
  args: {
    onSubmit: fn(),
  },
} satisfies Meta<typeof LoginForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Submitting: Story = {
  args: {
    isSubmitting: true,
  },
};

export const WithError: Story = {
  args: {
    errorMessage: "Credenciales invalidas.",
  },
};
