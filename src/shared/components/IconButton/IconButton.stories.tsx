import { Filter } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { IconButton } from "./IconButton";

const meta = {
  component: IconButton,
  tags: ["ai-generated"],
  args: {
    "aria-label": "Mostrar filtros",
    icon: <Filter className="h-4 w-4" />,
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Secondary: Story = {};

export const Outline: Story = {
  args: {
    variant: "outline",
  },
};
