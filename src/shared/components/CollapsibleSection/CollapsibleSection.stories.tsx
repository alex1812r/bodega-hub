import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { InfoGrid } from "@/shared/components/InfoGrid";

import { CollapsibleSection } from "./CollapsibleSection";

const meta = {
  component: CollapsibleSection,
  tags: ["ai-generated"],
  args: {
    title: "Datos del proveedor",
    summary: "Distribuidora El Sol · J-12345678-9 · 3 contactos",
    children: (
      <InfoGrid
        items={[
          { label: "Nombre", value: "Distribuidora El Sol" },
          { label: "RIF", value: "J-12345678-9" },
          { label: "Contactos", value: "3" },
        ]}
      />
    ),
  },
} satisfies Meta<typeof CollapsibleSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: { defaultOpen: true },
};

export const ClosedWithSummary: Story = {
  args: { defaultOpen: false },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: /datos del proveedor/i });

    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByText(/3 contactos/i)).toBeVisible();

    await userEvent.click(trigger);

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // El contenido entra con un fundido de 200 ms: se espera a que termine.
    await waitFor(() => expect(canvas.getByText("Distribuidora El Sol")).toBeVisible());

    await userEvent.click(trigger);

    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  },
};

export const WithStorageKey: Story = {
  args: {
    defaultOpen: false,
    storageKey: "storybook:collapsible-section:proveedor",
    title: "Recuerda si quedó abierta",
    summary: "Ábrela y recarga la historia: se mantiene abierta.",
  },
};

export const LongContent: Story = {
  args: {
    defaultOpen: true,
    title: "Historial de movimientos del día con un título bastante largo",
    summary: "24 movimientos registrados entre entradas, salidas y ajustes de inventario",
    children: (
      <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
        {Array.from({ length: 24 }, (_, index) => (
          <li
            className="border-b border-slate-100 pb-2 last:border-b-0 dark:border-slate-800"
            key={index}
          >
            Movimiento {index + 1}: entrada de mercancía recibida en almacén principal y
            verificada contra la factura del proveedor.
          </li>
        ))}
      </ul>
    ),
  },
};
