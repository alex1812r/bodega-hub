import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TaxSettingsSection } from "./TaxSettingsSection";

const meta = {
  component: TaxSettingsSection,
  title: "Modules/Settings/TaxSettingsSection",
  tags: ["ai-generated"],
  args: {
    canEdit: true,
  },
} satisfies Meta<typeof TaxSettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Impuestos: catálogo de alícuotas de IVA y alícuota por defecto para categorías nuevas. */
export const Default: Story = {};

/** Sin permiso para guardar ajustes: la sección solo se lee. */
export const ReadOnly: Story = {
  args: {
    canEdit: false,
  },
};
