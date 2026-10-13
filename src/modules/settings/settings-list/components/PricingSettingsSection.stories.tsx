import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PricingSettingsSection } from "./PricingSettingsSection";

const meta = {
  component: PricingSettingsSection,
  title: "Modules/Settings/PricingSettingsSection",
  tags: ["ai-generated"],
  args: {
    canEdit: true,
  },
} satisfies Meta<typeof PricingSettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Precios: umbrales del semáforo de ganancia y porcentajes recomendados. */
export const Default: Story = {};

/** Sin permiso para guardar ajustes: la sección solo se lee. */
export const ReadOnly: Story = {
  args: {
    canEdit: false,
  },
};
