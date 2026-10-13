import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Tabs, type TabItem } from "./Tabs";

/**
 * Pestañas compartidas con API declarativa: cada elemento de `items` trae su
 * `value`, `label`, `content` y, si hace falta, `badge` y `disabled`.
 *
 * - No controlado: `defaultValue` (o la primera habilitada).
 * - Controlado: `value` + `onValueChange`.
 * - En la URL: `urlParam="tab"` lee la pestaña al montar y la escribe con
 *   `window.history.replaceState` nativo (sin navegación del router ni ida al
 *   servidor) conservando los demás parámetros;
 *   la pestaña por defecto se omite y un valor inválido cae al default.
 *   `urlParam` y `value` no se combinan. El límite de Suspense que exige
 *   `useSearchParams` lo pone el propio componente.
 *
 * Teclado: flechas izquierda/derecha, Home y End; saltan las deshabilitadas y
 * activan la pestaña al moverse.
 */
const meta = {
  component: Tabs,
  tags: ["ai-generated"],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

function panel(text: string) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

const baseItems: TabItem[] = [
  { value: "resumen", label: "Resumen", content: panel("Datos generales del contacto.") },
  { value: "ventas", label: "Ventas", content: panel("Ventas registradas a este contacto.") },
  { value: "pagos", label: "Pagos", content: panel("Pagos recibidos de este contacto.") },
];

export const Basic: Story = {
  args: {
    ariaLabel: "Secciones del contacto",
    items: baseItems,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: /ventas/i }));

    await expect(canvas.getByRole("tabpanel")).toHaveTextContent(/ventas registradas/i);
  },
};

export const WithBadges: Story = {
  args: {
    ariaLabel: "Secciones del contacto",
    defaultValue: "ventas",
    items: [
      baseItems[0],
      { ...baseItems[1], badge: 12 },
      { ...baseItems[2], badge: 3 },
    ],
  },
};

export const WithDisabled: Story = {
  args: {
    ariaLabel: "Secciones del contacto",
    items: [
      baseItems[0],
      { ...baseItems[1], disabled: true },
      baseItems[2],
    ],
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: /resumen/i }));
    await userEvent.keyboard("{ArrowRight}");

    await expect(canvas.getByRole("tab", { name: /pagos/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

const manyLabels = [
  "Resumen",
  "Ventas",
  "Compras",
  "Pagos",
  "Cuentas por cobrar",
  "Cuentas por pagar",
  "Devoluciones",
  "Movimientos de stock",
  "Notas",
  "Historial",
];

export const ManyTabs: Story = {
  args: {
    ariaLabel: "Secciones del contacto",
    items: manyLabels.map((label, index) => ({
      value: `seccion-${index}`,
      label,
      badge: index % 3 === 1 ? index : undefined,
      content: panel(`Contenido de ${label}.`),
    })),
  },
  decorators: [
    (Story) => (
      <div className="w-[358px] max-w-full">
        <Story />
      </div>
    ),
  ],
};

/** Sin pestañas: queda la barra vacía, sin paneles y sin error. */
export const Empty: Story = {
  args: {
    ariaLabel: "Secciones del contacto",
    items: [],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tablist")).toBeInTheDocument();
    await expect(canvas.queryByRole("tab")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tabpanel")).not.toBeInTheDocument();
  },
};

/** Monta con la última pestaña activa: la barra se desplaza sola para mostrarla. */
export const ManyTabsLastActive: Story = {
  ...ManyTabs,
  args: {
    ...ManyTabs.args,
    defaultValue: "seccion-9",
  },
};

export const WithUrlParam: Story = {
  args: {
    ariaLabel: "Secciones del contacto",
    items: baseItems,
    urlParam: "tab",
  },
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/contactos/c-1",
        query: { q: "harina", tab: "pagos" },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("tab", { name: /pagos/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};
