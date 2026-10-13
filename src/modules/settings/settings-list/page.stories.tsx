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

/** `?tab=usuarios` abre la pestaña Usuarios; su página va en `usersPage`. */
export const UsersTab: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/settings", query: { tab: "usuarios" } } },
  },
};

/** `?tab=tasas` abre la pestaña Tasas; la página del historial va en `ratesPage`. */
export const RatesTab: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/settings", query: { tab: "tasas" } } },
  },
};
