import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge } from "@/shared/components/Badge";

import { InfoGrid } from "./InfoGrid";

const meta = {
  component: InfoGrid,
  tags: ["ai-generated"],
  args: {
    items: [
      { label: "Precio ref", value: "ref 4.20" },
      { label: "Stock", value: "24 unidades" },
      { label: "Estado", value: <Badge variant="success">Activo</Badge> },
    ],
  },
} satisfies Meta<typeof InfoGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeColumns: Story = {};

export const TwoColumns: Story = {
  args: {
    columns: 2,
  },
};
