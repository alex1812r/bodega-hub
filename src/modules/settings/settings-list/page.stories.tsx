import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SettingsListPage } from "./page";

const meta = {
  component: SettingsListPage,
  title: "Modules/Settings/SettingsListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof SettingsListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
