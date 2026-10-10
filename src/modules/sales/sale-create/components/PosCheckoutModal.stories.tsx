import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PosCheckoutModal } from "./PosCheckoutModal";

const meta = {
  args: {
    drawerRef: 40,
    drawerVes: 5000,
    enabledPaymentMethods: [
      "efectivo_usd",
      "efectivo_ves",
      "pago_movil",
      "punto_venta",
      "transferencia",
    ],
    onConfirm: () => {},
    onOpenChange: () => {},
    open: true,
    rateVes: 100,
    totalRef: 10,
  },
  component: PosCheckoutModal,
  tags: ["ai-generated"],
  title: "Modules/Sales/SaleCreatePage/PosCheckoutModal",
} satisfies Meta<typeof PosCheckoutModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Caso simple: pago móvil por el monto exacto, solo método y monto. El primer
 * «Cobrar» pide banco, teléfono y referencia sin errores; el segundo cobra.
 */
export const CompactoPagoMovil: Story = {
  args: { defaultMethod: "pago_movil" },
};

/** Efectivo sin monto: se escribe lo recibido o se toca un monto rápido. */
export const CompactoEfectivo: Story = {
  args: { defaultMethod: "efectivo_usd" },
};

/** Efectivo con diferencia: aparecen los billetes y el vuelto. */
export const EfectivoConVuelto: Story = {
  args: {
    initialCheckout: {
      change: { amount: 1000, denominations: { 200: 5 }, method: "efectivo_ves" },
      changeCarrierLineId: "usd",
      lines: [{ amount: 20, denominations: null, id: "usd", method: "efectivo_usd" }],
    },
  },
};

/** Pago bancario mayor que el total con vuelto en efectivo. */
export const BancoConVueltoEnEfectivo: Story = {
  args: {
    initialCheckout: {
      change: { amount: 500, denominations: { 100: 1, 200: 2 }, method: "efectivo_ves" },
      changeCarrierLineId: "pv",
      lines: [{ amount: 1500, id: "pv", method: "punto_venta", referenceCode: "5566" }],
    },
  },
};

/** Más de un pago: arranca expandido para no esconder datos. */
export const PagoMixto: Story = {
  args: {
    initialCheckout: {
      change: null,
      changeCarrierLineId: null,
      lines: [
        { amount: 4, denominations: { 1: 4 }, id: "usd", method: "efectivo_usd" },
        { amount: 600, id: "pv", method: "punto_venta", referenceCode: "9911" },
      ],
    },
  },
};
