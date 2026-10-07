import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";

import { ConfirmActionModal } from "./ConfirmActionModal";

const meta = {
  args: {
    confirmLabel: "Recibir compra",
    description: "La compra pasará a recibida y el inventario se actualizará.",
    onConfirm: fn(),
    onOpenChange: fn(),
    open: true,
    title: "Recibir compra C-0045",
  },
  component: ConfirmActionModal,
  tags: ["ai-generated"],
} satisfies Meta<typeof ConfirmActionModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const saleCancelEffects = [
  { after: "17", before: "12", label: "Stock de Harina PAN 1 kg", tone: "positive" },
  { after: "30", before: "24", label: "Stock de Refresco Cola 2 L", tone: "positive" },
  { after: "Anulada", before: "Pagada", label: "Estado de la venta", tone: "danger" },
  { label: "El pago en efectivo vuelve a la caja", tone: "warning" },
] as const;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole("dialog")).toBeVisible();
    await expect(body.getByRole("button", { name: "Recibir compra" })).toHaveFocus();
  },
};

export const Danger: Story = {
  args: {
    confirmLabel: "Anular venta",
    description: "La venta quedará anulada. Esta acción no se puede deshacer.",
    title: "Anular venta V-0012",
    variant: "danger",
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole("button", { name: "Cancelar" })).toHaveFocus();
  },
};

export const WithBeforeAfterEffects: Story = {
  args: {
    ...Danger.args,
    effects: [...saleCancelEffects],
  },
};

export const WithTypedConfirmation: Story = {
  args: {
    ...Danger.args,
    effects: [...saleCancelEffects],
    requireTypedConfirmation: "ANULAR",
  },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);
    const confirmButton = await body.findByRole("button", { name: "Anular venta" });

    await expect(confirmButton).toBeDisabled();
    await userEvent.type(body.getByRole("textbox", { name: "Palabra de confirmación" }), " anular ");
    await expect(confirmButton).toBeEnabled();
  },
};

export const Pending: Story = {
  args: {
    ...Danger.args,
    effects: [...saleCancelEffects],
    isPending: true,
  },
};

export const WithError: Story = {
  args: {
    ...Danger.args,
    effects: [...saleCancelEffects],
    error: "La caja de esta venta ya está cerrada.",
  },
};

export const LongEffectsList: Story = {
  args: {
    ...Danger.args,
    effects: Array.from({ length: 40 }, (_, index) => ({
      after: String(20 + index),
      before: String(10 + index),
      label: `Stock del producto ${index + 1}`,
      tone: "positive" as const,
    })),
    requireTypedConfirmation: "ANULAR",
  },
};

export const CustomEffects: Story = {
  args: {
    confirmLabel: "Anular pago",
    description: "El pago quedará anulado y el documento volverá a tener saldo pendiente.",
    renderEffects: () => (
      <p className="py-2 text-sm text-foreground">
        Vuelven Bs 1.200,00 a la caja principal y la venta V-0012 queda pendiente de pago.
      </p>
    ),
    title: "Anular pago",
    variant: "danger",
  },
};

export const Mobile390: Story = {
  args: {
    ...LongEffectsList.args,
    error: "La caja de esta venta ya está cerrada.",
  },
  globals: {
    viewport: { isRotated: false, value: "mobile390" },
  },
  parameters: {
    viewport: {
      options: {
        mobile390: {
          name: "Móvil 390 px",
          styles: { height: "844px", width: "390px" },
          type: "mobile",
        },
      },
    },
  },
};
