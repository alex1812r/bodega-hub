import type { Meta, StoryObj } from "@storybook/react";

import { ProgressBar } from "./ProgressBar";

const meta = {
  component: ProgressBar,
  title: "Shared/ProgressBar",
} satisfies Meta<typeof ProgressBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const HalfComplete: Story = {
  args: {
    label: "Importando productos",
    max: 10,
    value: 5,
  },
};

export const Complete: Story = {
  args: {
    label: "Completado",
    max: 20,
    value: 20,
  },
};
