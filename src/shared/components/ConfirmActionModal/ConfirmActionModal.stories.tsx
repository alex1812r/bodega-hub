import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ComponentProps, useEffect, useState } from "react";
import { expect, fn, waitFor, within } from "storybook/test";

import { Button } from "../Button";
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

/**
 * El modal oculta el error que ya venía puesto al abrir (es de un intento anterior),
 * así que estas stories lo entregan justo después, como haría un intento fallido.
 */
function ErrorAfterOpening({ error, ...props }: ComponentProps<typeof ConfirmActionModal>) {
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setHasFailed(true), 0);

    return () => window.clearTimeout(timer);
  }, []);

  return <ConfirmActionModal {...props} error={hasFailed ? error : null} />;
}

/** Simula un efecto que tarda 1,2 s en llegar. */
function LoadsThenReady(props: ComponentProps<typeof ConfirmActionModal>) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsLoaded(true), 1200);

    return () => window.clearTimeout(timer);
  }, []);

  return <ConfirmActionModal {...props} status={isLoaded ? "ready" : "loading"} />;
}

function OpenedFromTrigger({
  onOpenChange,
  open: initiallyOpen,
  ...props
}: ComponentProps<typeof ConfirmActionModal>) {
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="danger">
        Anular venta V-0012
      </Button>
      <ConfirmActionModal
        {...props}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          onOpenChange(nextOpen);
        }}
        open={open}
      />
    </>
  );
}

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
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(await within(await body.findByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "La caja de esta venta ya está cerrada.",
    );
  },
  render: (args) => <ErrorAfterOpening {...args} />,
};

/** Un error que ya estaba puesto al abrir no se muestra: es de otro intento. */
export const StaleErrorHidden: Story = {
  args: {
    ...Danger.args,
    effects: [...saleCancelEffects],
    error: "Este error es de un intento anterior y no debe verse.",
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole("dialog")).toBeVisible();
    await expect(within(await body.findByRole("dialog")).queryByRole("alert")).toBeNull();
  },
};

/**
 * `onConfirm` síncrono (no devuelve promesa): el doble clic ejecuta la acción una vez.
 * El botón queda ocupado ~1 s y se libera solo si el llamador no da ninguna señal.
 */
export const SyncConfirm: Story = {
  args: {
    ...Danger.args,
    effects: [...saleCancelEffects],
    onConfirm: fn(),
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.dblClick(await body.findByRole("button", { name: "Anular venta" }));

    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
    await expect(body.getByRole("button", { name: "Procesando..." })).toBeDisabled();
    await waitFor(() => expect(body.getByRole("button", { name: "Anular venta" })).toBeEnabled(), {
      timeout: 3000,
    });
  },
};

/** `onConfirm` asíncrono (promesa de 1,5 s): el doble clic ejecuta la acción una vez. */
export const AsyncConfirm: Story = {
  args: {
    ...Danger.args,
    effects: [...saleCancelEffects],
    onConfirm: fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1500))),
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.dblClick(await body.findByRole("button", { name: "Anular venta" }));

    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
    await expect(body.getByRole("button", { name: "Procesando..." })).toBeDisabled();
    await waitFor(() => expect(body.getByRole("button", { name: "Anular venta" })).toBeEnabled(), {
      timeout: 4000,
    });
  },
};

/** Al cerrar, el foco vuelve al botón que abrió el modal. */
export const ReturnsFocusToTrigger: Story = {
  args: {
    ...Danger.args,
    effects: [...saleCancelEffects],
    open: false,
  },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);
    const trigger = body.getByRole("button", { name: "Anular venta V-0012" });

    await userEvent.click(trigger);
    await expect(await body.findByRole("button", { name: "Cancelar" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
  render: (args) => <OpenedFromTrigger {...args} />,
};

/** La lista desborda: su zona con scroll es una parada de Tab y se recorre con el teclado. */
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
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const effects = await body.findByRole("group", { name: "Qué va a pasar" });

    await expect(effects).toHaveAttribute("tabindex", "0");
    effects.focus();
    await expect(effects).toHaveFocus();
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

/** El efecto aún se está calculando: mismo diálogo, sin botón de confirmar. */
export const EffectLoading: Story = {
  args: {
    ...Danger.args,
    status: "loading",
    statusHint: "Hasta conocerlo no se puede anular.",
    statusMessage: "Calculando el efecto de anular la venta…",
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(await within(await body.findByRole("dialog")).findByRole("status")).toHaveTextContent("Calculando el efecto");
    await expect(body.queryByRole("button", { name: "Anular venta" })).toBeNull();
    await expect(body.getByRole("button", { name: "Cerrar" })).toHaveFocus();
  },
};

/** El efecto no se pudo calcular: se dice el error y solo se puede reintentar o cerrar. */
export const EffectError: Story = {
  args: {
    ...Danger.args,
    onRetry: fn(),
    status: "error",
    statusHint: "Sin el efecto a la vista no se puede confirmar. No se ha cambiado nada.",
    statusMessage: "Venta no encontrada",
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(await within(await body.findByRole("dialog")).findByRole("alert")).toHaveTextContent("Venta no encontrada");
    await expect(body.queryByRole("button", { name: "Anular venta" })).toBeNull();
    await userEvent.click(body.getByRole("button", { name: "Reintentar" }));
    await expect(args.onRetry).toHaveBeenCalledTimes(1);
  },
};

/** La acción no se puede ejecutar: motivo tal cual y las salidas que pasa quien lo usa. */
export const EffectBlocked: Story = {
  args: {
    ...Danger.args,
    blockedActions: <Button variant="outline">Devolver la venta</Button>,
    children: "Venta V-0012 · Cliente Demo · Cobrado Bs 7.650,00",
    description: "La acción no se puede ejecutar ahora. No se ha cambiado nada.",
    status: "blocked",
    statusMessage: "La venta V-0012 tiene 1 pago(s) activo(s) por Bs 7.650,00.",
    title: "No se puede anular la venta",
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(await within(await body.findByRole("dialog")).findByRole("alert")).toHaveTextContent("1 pago(s) activo(s)");
    await expect(body.queryByRole("button", { name: "Anular venta" })).toBeNull();
    await expect(body.getByRole("button", { name: "Devolver la venta" })).toBeVisible();
  },
};

/** De la carga al efecto listo sin cambiar de diálogo: el foco pasa a la palabra tecleada. */
export const LoadingThenReady: Story = {
  args: {
    ...Danger.args,
    effects: [...saleCancelEffects],
    requireTypedConfirmation: "ANULAR",
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog");

    await expect(within(dialog).getByRole("status")).toBeVisible();
    await waitFor(
      () => expect(body.getByRole("textbox", { name: "Palabra de confirmación" })).toHaveFocus(),
      { timeout: 4000 },
    );
    await expect(body.getByRole("dialog")).toBe(dialog);
  },
  render: (args) => <LoadsThenReady {...args} />,
};

export const Mobile390: Story = {
  args: {
    ...LongEffectsList.args,
    error: "La caja de esta venta ya está cerrada.",
  },
  render: (args) => <ErrorAfterOpening {...args} />,
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
