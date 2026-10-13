import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, within } from "storybook/test";

import type { TaxRate } from "@/shared/hooks/useTaxRates";

import { Button } from "../Button";
import { Modal } from "../Modal";
import { TaxRateChips, type TaxRateChipsProps } from "./TaxRateChips";

const catalog: TaxRate[] = [
  { code: "exento", id: "tax-exento", isActive: true, isDefault: false, isGlobal: true, label: "Exento", pct: 0, sortOrder: 10 },
  { code: "reducida", id: "tax-reducida", isActive: true, isDefault: false, isGlobal: true, label: "Reducida", pct: 8, sortOrder: 20 },
  { code: "general", id: "tax-general", isActive: true, isDefault: true, isGlobal: true, label: "General", pct: 16, sortOrder: 30 },
  { code: "lujo", id: "tax-lujo", isActive: false, isDefault: false, isGlobal: false, label: "Lujo", pct: 31, sortOrder: 40 },
];

type DemoProps = Omit<TaxRateChipsProps, "onChange" | "value"> & {
  initialValue: string | null;
};

function Demo({ initialValue, ...props }: DemoProps) {
  const [value, setValue] = useState(initialValue);

  return <TaxRateChips rates={catalog} {...props} onChange={setValue} value={value} />;
}

const meta = {
  component: TaxRateChips,
  tags: ["ai-generated"],
  args: {
    onChange: fn(),
    rates: catalog,
    value: "general",
  },
} satisfies Meta<typeof TaxRateChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basico: Story = {
  name: "Básico",
  render: () => <Demo initialValue="general" />,
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(body.getByRole("button", { name: /Alícuota de IVA/ }));
    await expect(await body.findByRole("radio", { name: /General/ })).toBeChecked();
  },
};

export const ConDefectoDeCategoria: Story = {
  name: "Con por defecto de la categoría",
  render: () => <Demo categoryDefaultCode="reducida" initialValue="general" />,
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(body.getByRole("button", { name: /Alícuota de IVA/ }));
    await expect(await body.findByRole("radio", { name: /Reducida/ })).toHaveTextContent(
      "por defecto",
    );
  },
};

export const Exento: Story = {
  render: () => <Demo initialValue="exento" />,
};

export const SinElegir: Story = {
  name: "Sin elegir",
  render: () => <Demo initialValue={null} />,
};

export const ValorInactivo: Story = {
  name: "Valor inactivo",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Demo initialValue="lujo" label="IVA de una alícuota desactivada" />
      <Demo initialValue="otro-12.5" label="IVA de una línea antigua" />
    </div>
  ),
};

export const Deshabilitado: Story = {
  args: { disabled: true },
};

export const TamanoMd: Story = {
  name: "Tamaño md",
  render: () => <Demo initialValue="general" size="md" />,
};

export const Cargando: Story = {
  args: { isLoading: true, rates: [] },
};

export const ErrorDeCarga: Story = {
  name: "Error de carga",
  args: {
    error: new Error("No se pudo completar la solicitud."),
    onRetry: fn(),
    rates: [],
  },
};

export const CatalogoVacio: Story = {
  name: "Catálogo vacío",
  args: { rates: [], value: null },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(body.getByRole("button", { name: /Alícuota de IVA/ }));
    await expect(await body.findByText("No hay alícuotas activas.")).toBeVisible();
  },
};

const purchaseLines = [
  { id: "line-1", name: "Harina PAN 1 kg", qty: 24, taxCode: "exento" },
  { id: "line-2", name: "Refresco Cola 2 L", qty: 12, taxCode: "general" },
  { id: "line-3", name: "Whisky 12 años 750 ml", qty: 2, taxCode: "lujo" },
];

export const EnFilaDeTabla: Story = {
  name: "Dentro de una fila de tabla",
  render: () => (
    <div className="max-w-xl overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
          <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Producto</th>
              <th className="px-3 py-2 text-right font-medium">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {purchaseLines.map((line) => (
              <tr className="border-t border-slate-200 dark:border-slate-800" key={line.id}>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{line.name}</span>
                    <Demo initialValue={line.taxCode} label={`IVA de ${line.name}`} />
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{line.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(body.getByRole("button", { name: /IVA de Whisky/ }));
    await expect(await body.findByRole("radiogroup")).toBeVisible();
  },
};

export const DentroDeModal: Story = {
  name: "Dentro de un Modal",
  render: () => (
    <Modal
      description="El popover se monta dentro del diálogo: conserva el foco y no lo cierra."
      footer={<Button>Guardar</Button>}
      open
      title="Nueva categoría"
    >
      <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <span>Alícuota de IVA</span>
        <Demo initialValue="general" />
      </div>
    </Modal>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(body.getByRole("button", { name: /Alícuota de IVA/ }));
    await expect(await body.findByRole("radiogroup")).toBeVisible();
  },
};

export const Mobile390: Story = {
  name: "390 px",
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
  render: () => (
    <div className="flex items-center justify-between gap-2 text-sm text-slate-700 dark:text-slate-300">
      <span className="truncate">Refresco Cola 2 L retornable</span>
      <Demo categoryDefaultCode="general" initialValue="reducida" />
    </div>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(body.getByRole("button", { name: /Alícuota de IVA/ }));
    await expect(await body.findByRole("radiogroup")).toBeVisible();
  },
};
