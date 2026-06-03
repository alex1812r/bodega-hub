import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge } from "./Badge";

const meta = {
  component: Badge,
  tags: ["ai-generated"],
  args: {
    children: "Pendiente",
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Base</Badge>
      <Badge variant="success">Pagada</Badge>
      <Badge variant="warning">Pendiente</Badge>
      <Badge variant="danger">Cancelada</Badge>
      <Badge variant="info">En proceso</Badge>
    </div>
  ),
};
