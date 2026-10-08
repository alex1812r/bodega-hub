import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { Button } from "../Button";
import { type ToastOptions, ToastProvider, useToast } from "./Toast";

/**
 * Avisos breves que no interrumpen (regla 12 del plan de UX).
 *
 * - `<ToastProvider>` va una vez en la raíz; la app y Storybook ya lo montan
 *   en `AppProviders`, así que aquí basta con `useToast()`.
 * - `useToast()` devuelve `showToast({ title, description?, tone?, action?, durationMs? })`
 *   (da el id del aviso) y `dismiss(id)`. Fuera del proveedor no lanza: no hace nada.
 * - `tone`: `"success" | "error" | "info"` (por defecto `"info"`). Los de error
 *   se anuncian como `alert`, se pintan arriba y no se cierran solos.
 * - `action`: `{ label, href }` (enlace interno) o `{ label, onClick }`.
 * - Autocierre a los 6 s (`durationMs`; `0` lo deja fijo), en pausa con el
 *   puntero o el foco encima. Hasta 3 a la vez: el más antiguo se descarta.
 * - No mueve el foco. Con un `Modal` abierto se ve y se puede pulsar, pero el
 *   teclado no llega a él mientras el modal retiene el foco.
 */
const meta = {
  component: ToastProvider,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ToastProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

function ToastLauncher({ label, toasts }: { label: string; toasts: ToastOptions[] }) {
  const { showToast } = useToast();

  return <Button onClick={() => toasts.forEach((toast) => showToast(toast))}>{label}</Button>;
}

function launcherStory(label: string, toasts: ToastOptions[], expectedTitle: string): Story {
  return {
    args: { children: null },
    play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole("button", { name: label }));

      const body = within(canvasElement.ownerDocument.body);

      await expect(await body.findByText(expectedTitle)).toBeVisible();
    },
    render: () => <ToastLauncher label={label} toasts={toasts} />,
  };
}

export const SuccessWithLink = launcherStory(
  "Crear producto",
  [
    {
      action: { href: "/products/prod-1", label: "Ver" },
      durationMs: 0,
      title: "Producto creado: Harina PAN 1 kg",
      tone: "success",
    },
  ],
  "Producto creado: Harina PAN 1 kg",
);

export const ErrorTone = launcherStory(
  "Guardar con fallo",
  [
    {
      description: "Revisa la conexión y vuelve a intentarlo.",
      title: "No se pudo guardar el contacto",
      tone: "error",
    },
  ],
  "No se pudo guardar el contacto",
);

export const Stack = launcherStory(
  "Lanzar cuatro avisos",
  [
    { durationMs: 0, title: "Primero (se descarta)" },
    { durationMs: 0, title: "Contacto creado: Distribuidora Polar", tone: "success" },
    { durationMs: 0, title: "Precio actualizado", tone: "info" },
    { title: "No se pudo subir la imagen", tone: "error" },
  ],
  "No se pudo subir la imagen",
);

export const LongText = launcherStory(
  "Aviso con texto largo",
  [
    {
      action: { label: "Reintentar", onClick: () => undefined },
      description: `Referencia ${"X".repeat(160)}`,
      durationMs: 0,
      title: `Producto creado: ${"Harina".repeat(40)}`,
      tone: "success",
    },
  ],
  `Producto creado: ${"Harina".repeat(40)}`,
);
