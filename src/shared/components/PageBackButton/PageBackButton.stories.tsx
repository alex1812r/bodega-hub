import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { RETURN_TO_PARAM } from "@/shared/utils/returnTo";

import { PageBackButton } from "./PageBackButton";

/**
 * Botón "Volver" de los detalles.
 *
 * - El enlace de la fila de la lista se construye con
 *   `withReturnTo("/products/p-1", list.href)`, que añade `?returnTo=<URL de la lista>`.
 * - En el detalle, `<PageBackButton fallbackHref="/products" />` vuelve a
 *   `returnTo` si es una ruta interna válida y, si no, a `fallbackHref`.
 * - `Esc` y `Alt+←` también vuelven (no con un diálogo o desplegable abierto ni
 *   con el foco en un campo). `shortcuts={false}` los apaga.
 * - Solo con `href` (forma heredada) es un enlace fijo: no lee `returnTo` ni activa atajos.
 *
 * El límite de Suspense de `useSearchParams` lo pone el propio componente.
 */
const meta = {
  args: {
    fallbackHref: "/products",
  },
  component: PageBackButton,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/products/p-1",
      },
    },
  },
  tags: ["ai-generated"],
} satisfies Meta<typeof PageBackButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithReturnTo: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/products/p-1",
        query: { [RETURN_TO_PARAM]: "/products?search=harina&page=3" },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/products?search=harina&page=3",
    );
  },
};

export const WithoutReturnTo: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/products",
    );
  },
};

export const ExternalReturnToRejected: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/products/p-1",
        query: { [RETURN_TO_PARAM]: "//evil.com" },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/products",
    );
  },
};

export const CustomLabel: Story = {
  args: {
    fallbackHref: "/cash/registers",
    label: "Volver a cajas",
    size: "sm",
  },
};

export const LegacyHref: Story = {
  args: {
    fallbackHref: undefined,
    href: "/purchases",
  },
};
