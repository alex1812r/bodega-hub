import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DateRangeField } from "@/shared/components/DateRangeField";
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
        <DateRangeField
          label="Rango de fechas"
          onChange={() => undefined}
          size="sm"
          today="2026-10-09"
          value={{ preset: "last_month" }}
        />
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
