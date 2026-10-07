import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";

import { type ProcessGuardLeaveMode, useProcessGuard } from "@/shared/hooks/useProcessGuard";

import { Button } from "../Button";
import { Input } from "../Input";
import { GuardedLink, ProcessGuard, ProcessGuardModal } from "./ProcessGuard";

/**
 * Guardia de procesos críticos (regla 14 del plan de UX).
 *
 * - `useProcessGuard({ active, label, onLeave, onSaveDraft?, onDiscard?, description? })`
 *   devuelve `guardedNavigate`, `requestLeave`, `bypass`, `runUnguarded` y
 *   `dialog`; el modal se pinta con `<ProcessGuardModal guard={guard} />`.
 * - `<ProcessGuard ... />` hace las dos cosas cuando no hacen falta las funciones.
 * - Con `active` en `false` no hay listeners ni intercepción.
 * - Con `active` en `true`: clic en enlaces internos, atrás/adelante del
 *   navegador y `guardedNavigate` abren el modal; cerrar o recargar la pestaña
 *   muestra el aviso nativo del navegador (`beforeunload`).
 * - `GuardedLink` es `next/link` bloqueado con `onNavigate`; los demás enlaces
 *   se interceptan con un listener global mientras hay un guardia activo.
 *
 * Para probarlo a mano: escribe en el formulario y pulsa cualquier enlace,
 * el botón atrás del navegador o F5.
 */
const meta = {
  component: ProcessGuard,
  parameters: { layout: "padded" },
  tags: ["ai-generated"],
} satisfies Meta<typeof ProcessGuard>;

export default meta;
type Story = StoryObj<typeof meta>;

type FakeFormProps = {
  onLeave: ProcessGuardLeaveMode;
  processName: string;
};

function FakeForm({ onLeave, processName }: FakeFormProps) {
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const dirty = supplier.trim() !== "" || lines > 0;

  function addLog(entry: string) {
    setLog((current) => [...current, entry]);
  }

  const guard = useProcessGuard({
    active: dirty,
    description:
      onLeave === "draft" ? "Podrás restaurarla al volver a esta pantalla." : undefined,
    label: `${processName}${supplier.trim() ? ` a ${supplier.trim()}` : ""} · ${lines} líneas`,
    onDiscard: () => addLog("onDiscard"),
    onLeave,
    onSaveDraft: () => addLog("onSaveDraft"),
  });

  function reset() {
    setSupplier("");
    setLines(0);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 text-sm text-foreground">
      <nav aria-label="Enlaces de prueba" className="flex flex-wrap gap-x-4 gap-y-2 text-primary">
        <GuardedLink className="underline" href="/sales">
          Ventas (GuardedLink)
        </GuardedLink>
        <a className="underline" href="/inventory">
          Inventario (enlace normal)
        </a>
        <a className="underline" href="#lineas">
          Ancla de la página
        </a>
        <a className="underline" href="https://example.com" rel="noreferrer" target="_blank">
          Externo en pestaña nueva
        </a>
      </nav>

      <Input
        label="Proveedor"
        onChange={(event) => setSupplier(event.target.value)}
        placeholder="Distribuidora X"
        value={supplier}
      />

      <p id="lineas">
        Líneas: <strong>{lines}</strong> · Guardia: <strong>{dirty ? "activo" : "inactivo"}</strong>
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setLines((current) => current + 1)} variant="outline">
          Agregar línea
        </Button>
        <Button onClick={() => guard.guardedNavigate("/purchases")} variant="outline">
          Volver al listado
        </Button>
        <Button onClick={() => guard.requestLeave(reset)} variant="outline">
          Cerrar formulario
        </Button>
        <Button
          onClick={() =>
            guard.runUnguarded(() => {
              addLog("confirmado sin preguntar");
              reset();
            })
          }
        >
          Confirmar
        </Button>
      </div>

      <p aria-label="Registro" className="text-on-surface-variant" role="status">
        {log.length > 0 ? log.join(" → ") : "Sin eventos"}
      </p>

      <ProcessGuardModal guard={guard} />
    </div>
  );
}

const baseArgs = { active: true, label: "Compra", onLeave: "draft" } as const;

export const Draft: Story = {
  args: baseArgs,
  render: () => <FakeForm onLeave="draft" processName="Compra" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.type(canvas.getByLabelText(/proveedor/i), "Distribuidora X");
    await userEvent.click(canvas.getByRole("button", { name: /agregar línea/i }));
    await userEvent.click(canvas.getByRole("link", { name: /inventario/i }));

    const dialog = await body.findByRole("dialog");

    await expect(dialog).toHaveTextContent("Compra a Distribuidora X · 1 líneas");
    await expect(dialog).toHaveTextContent(/se guardará un borrador/i);
    await expect(body.getByRole("button", { name: "Seguir aquí" })).toHaveFocus();
  },
};

export const Discard: Story = {
  args: { ...baseArgs, onLeave: "discard" },
  render: () => <FakeForm onLeave="discard" processName="Producto nuevo" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: /agregar línea/i }));
    await userEvent.click(canvas.getByRole("button", { name: /cerrar formulario/i }));

    await expect(await body.findByRole("dialog")).toHaveTextContent(/se perderán los cambios/i);
  },
};

export const StayKeepsEverything: Story = {
  args: baseArgs,
  render: () => <FakeForm onLeave="draft" processName="Compra" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.type(canvas.getByLabelText(/proveedor/i), "Distribuidora X");
    await userEvent.click(canvas.getByRole("link", { name: /ventas/i }));
    await userEvent.click(await body.findByRole("button", { name: "Seguir aquí" }));

    await expect(canvas.getByLabelText(/proveedor/i)).toHaveValue("Distribuidora X");
    await expect(canvas.getByRole("status")).toHaveTextContent("Sin eventos");
  },
};

export const InactiveDoesNothing: Story = {
  args: { ...baseArgs, active: false },
  render: () => <FakeForm onLeave="draft" processName="Compra" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: /cerrar formulario/i }));

    await expect(body.queryByRole("dialog")).not.toBeInTheDocument();
  },
};
