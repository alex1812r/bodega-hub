import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { RouteError } from "./RouteError";

const meta = {
  component: RouteError,
  tags: ["ai-generated"],
  args: {
    error: new Error("Detalle interno que no se muestra"),
    retry: fn(),
    title: "Algo salió mal",
  },
} satisfies Meta<typeof RouteError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithSupportReference: Story = {
  args: {
    error: Object.assign(new Error("Detalle interno que no se muestra"), { digest: "3912847561" }),
  },
};

/** Dentro del `AppShell` el menú ya lleva al inicio: sin enlace. */
export const WithoutHomeLink: Story = {
  args: {
    homeHref: null,
    title: "No pudimos mostrar el dashboard",
  },
};

export const Mobile390: Story = {
  args: {
    error: Object.assign(new Error("Detalle interno que no se muestra"), { digest: "3912847561" }),
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
