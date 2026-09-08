import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";

import type { PayrollItem } from "../types";

import { PayrollItemRow } from "./PayrollItemRow";

const baseItem: PayrollItem = {
  commissionPct: 3,
  commissionRef: 45.6,
  employeeId: "employee-1",
  fullName: "Maria Perez",
  id: "item-1",
  paidAmount: null,
  paidAt: null,
  paidBy: null,
  paidCurrency: null,
  paidMethod: null,
  paidRateVes: null,
  paidRef: null,
  paidReference: null,
  paidVes: null,
  periodId: "period-1",
  profileId: "profile-1",
  reversalRef: -5.4,
  salesCount: 24,
  salesRef: 1520,
  status: "pendiente",
  storeId: "store-1",
  totalRef: 40.2,
  vaultMovementId: null,
};

const meta = {
  args: {
    item: baseItem,
    onCancelPayment: fn(),
    onPay: fn(),
    onReceipt: fn(),
    onViewSales: fn(),
    periodStatus: "aprobado",
  },
  component: PayrollItemRow,
  decorators: [
    (Story) => (
      <table className="min-w-full">
        <tbody>
          <Story />
        </tbody>
      </table>
    ),
  ],
  tags: ["ai-generated"],
} satisfies Meta<typeof PayrollItemRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Periodo aprobado: se puede pagar. */
export const Pendiente: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Pendiente")).toBeVisible();
    await expect(canvas.getByText("ref 40.20")).toBeVisible();
  },
};

/** Ya pagado: quedan "Anular pago" y "Recibo PDF". */
export const Pagado: Story = {
  args: {
    item: {
      ...baseItem,
      paidAmount: 20500,
      paidAt: "2026-09-02T14:00:00.000Z",
      paidCurrency: "VES",
      paidMethod: "pago_movil",
      paidRateVes: 510,
      paidRef: 40.2,
      paidReference: "1234",
      paidVes: 20502,
      status: "pagado",
      vaultMovementId: "vault-movement-1",
    },
    periodStatus: "pagado",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Pagado")).toBeVisible();
  },
};

/** Borrador: todavia no se paga nada, solo se puede auditar el detalle. */
export const Borrador: Story = {
  args: { periodStatus: "borrador" },
};

/** Sin permiso de gestion: solo "Ver ventas". */
export const SoloLectura: Story = {
  args: { canManage: false },
};
