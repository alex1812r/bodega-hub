import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CreditCard, PackageCheck } from "lucide-react";
import { expect, fn, within } from "storybook/test";

import { Badge } from "../Badge";
import { PrimaryStateAction } from "./PrimaryStateAction";

/**
 * Cabecera de los detalles (compra, venta, producto, contacto): hasta cuatro
 * cifras clave, UNA acción primaria que depende del estado del documento y el
 * menú "…" con las secundarias.
 *
 * - `figures`: máximo cuatro; a 390 px se ordenan en rejilla 2×2 y los importes
 *   largos parten línea en vez de desbordar. `hint` sirve para el equivalente
 *   en Bs y `tone` para destacar saldo o pagado.
 * - `primaryAction`: con `onClick` o con `href`. Si el estado no tiene acción,
 *   no se pasa y no se pinta botón. `isPending` la bloquea; `disabled` +
 *   `disabledReason` muestra el motivo y lo asocia al botón.
 * - `secondaryActions`: los mismos items de `ActionsMenu`.
 * - `notice`: aviso de estado junto a la acción (`role="status"`, o
 *   `role="alert"` con tono `danger`).
 *
 * Es solo presentación: el estado, los permisos y los importes ya formateados
 * los decide quien lo usa.
 */
const meta = {
  component: PrimaryStateAction,
  tags: ["ai-generated"],
  args: {
    ariaLabel: "Resumen de la compra",
  },
} satisfies Meta<typeof PrimaryStateAction>;

export default meta;
type Story = StoryObj<typeof meta>;

const purchaseSecondaryActions = [
  { label: "Descargar PDF", onSelect: fn() },
  { label: "Editar compra", href: "/purchases/demo/edit" },
  { label: "Anular compra", onSelect: fn(), variant: "danger" as const },
];

export const CompraEnPedido: Story = {
  args: {
    status: <Badge variant="warning">Pedido</Badge>,
    figures: [
      { label: "Total", value: "REF 1.250,00", hint: "Bs 187.500,00" },
      { label: "Pagado", value: "REF 0,00", hint: "Bs 0,00" },
      { label: "Saldo", value: "REF 1.250,00", hint: "Bs 187.500,00", tone: "warning" },
      { label: "Productos", value: "12", hint: "86 unidades" },
    ],
    notice: { tone: "warning", text: "El inventario no ha cambiado." },
    primaryAction: {
      label: "Recibir mercancía",
      icon: <PackageCheck aria-hidden="true" className="h-4 w-4" />,
      onClick: fn(),
    },
    secondaryActions: purchaseSecondaryActions,
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      /el inventario no ha cambiado/i,
    );

    await userEvent.click(canvas.getByRole("button", { name: /recibir mercancía/i }));

    await expect(args.primaryAction?.onClick).toHaveBeenCalledTimes(1);
  },
};

export const CompraRecibidaConSaldo: Story = {
  args: {
    status: <Badge variant="success">Recibida</Badge>,
    figures: [
      { label: "Total", value: "REF 1.250,00", hint: "Bs 187.500,00" },
      { label: "Pagado", value: "REF 400,00", hint: "Bs 60.000,00", tone: "success" },
      { label: "Saldo", value: "REF 850,00", hint: "Bs 127.500,00", tone: "danger" },
      { label: "Productos", value: "12", hint: "86 unidades" },
    ],
    primaryAction: {
      label: "Pagar",
      icon: <CreditCard aria-hidden="true" className="h-4 w-4" />,
      onClick: fn(),
    },
    secondaryActions: purchaseSecondaryActions,
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /más acciones/i }));

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole("menuitem", { name: /descargar pdf/i })).toBeVisible();
  },
};

export const VentaPagada: Story = {
  args: {
    ariaLabel: "Resumen de la venta",
    status: <Badge variant="success">Pagada</Badge>,
    figures: [
      { label: "Total", value: "REF 86,50", hint: "Bs 12.975,00" },
      { label: "Cobrado", value: "REF 86,50", hint: "Bs 12.975,00", tone: "success" },
      { label: "Saldo", value: "REF 0,00", hint: "Bs 0,00" },
      { label: "Productos", value: "7" },
    ],
    secondaryActions: [
      { label: "Ver recibo", onSelect: fn() },
      { label: "Anular venta", onSelect: fn(), variant: "danger" },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("button")).toHaveLength(1);
  },
};

export const Pendiente: Story = {
  args: {
    status: <Badge variant="warning">Pedido</Badge>,
    figures: CompraEnPedido.args.figures,
    notice: { tone: "warning", text: "El inventario no ha cambiado." },
    primaryAction: {
      label: "Recibir mercancía",
      onClick: fn(),
      isPending: true,
    },
    secondaryActions: purchaseSecondaryActions,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /recibir mercancía/i })).toBeDisabled();
  },
};

export const AccionDeshabilitadaConMotivo: Story = {
  args: {
    status: <Badge variant="success">Recibida</Badge>,
    figures: CompraRecibidaConSaldo.args.figures,
    primaryAction: {
      label: "Pagar",
      onClick: fn(),
      disabled: true,
      disabledReason: "No tienes permiso para registrar pagos.",
    },
  },
};

export const AvisoDePeligro: Story = {
  args: {
    ariaLabel: "Resumen de la venta",
    status: <Badge variant="danger">Vencida</Badge>,
    figures: [
      { label: "Total", value: "REF 320,00", hint: "Bs 48.000,00" },
      { label: "Cobrado", value: "REF 120,00", hint: "Bs 18.000,00" },
      { label: "Saldo", value: "REF 200,00", hint: "Bs 30.000,00", tone: "danger" },
    ],
    notice: { tone: "danger", text: "El crédito de esta venta venció hace 5 días." },
    primaryAction: { label: "Cobrar saldo", onClick: fn() },
  },
};

export const ResumenDeContacto: Story = {
  args: {
    ariaLabel: "Resumen del contacto",
    figures: [
      { label: "Total comprado", value: "REF 18.450,75", hint: "Bs 2.767.612,50" },
      { label: "Saldo", value: "REF 850,00", hint: "Bs 127.500,00", tone: "danger" },
    ],
  },
};

export const ImportesLargosEnMovil: Story = {
  args: {
    status: <Badge variant="success">Recibida</Badge>,
    figures: [
      { label: "Total", value: "REF 1.234.567.890,99", hint: "Bs 185.185.183.648,50" },
      { label: "Pagado", value: "REF 987.654.321,00", hint: "Bs 148.148.148.150,00" },
      { label: "Saldo", value: "REF 246.913.569,99", hint: "Bs 37.037.035.498,50" },
      { label: "Productos", value: "1.204", hint: "98.650 unidades" },
    ],
    notice: {
      tone: "info",
      text: "Esta compra tiene pagos registrados en varias monedas; el saldo se calcula en REF.",
    },
    primaryAction: { label: "Pagar", onClick: fn() },
    secondaryActions: purchaseSecondaryActions,
  },
  decorators: [
    (Story) => (
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
};
