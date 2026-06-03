import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Input } from "@/shared/components/Input";

import { FilterPanel } from "./FilterPanel";

const meta = {
  component: FilterPanel,
  tags: ["ai-generated"],
  args: {
    children: (
      <>
        <Input label="Nombre" placeholder="Buscar por nombre" />
        <Input label="Estado" placeholder="Activo, pendiente..." />
        <Input label="Fecha" type="date" />
      </>
    ),
  },
} satisfies Meta<typeof FilterPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = {
  args: {
    defaultOpen: true,
  },
};
