import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { createEmptyPaymentFormValues } from "@/shared/payments/PaymentFormFields";
import { DEFAULT_ENABLED_PAYMENT_METHODS } from "@/shared/payments/paymentMethods";

import { PurchasePaymentSection } from "./PurchasePaymentSection";
import { INITIAL_PAYMENT_INCOMPLETE_MESSAGE } from "../utils/purchaseInitialPayment";

const meta = {
  args: {
    methods: DEFAULT_ENABLED_PAYMENT_METHODS,
    onOpenChange: fn(),
    onValuesChange: fn(),
    open: false,
    rateVes: 510,
    totalVes: 2040,
    values: createEmptyPaymentFormValues(),
  },
  component: PurchasePaymentSection,
  title: "Modules/Purchases/PurchasePaymentSection",
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchasePaymentSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Colapsada: la compra se confirma sin pago. */
export const Default: Story = {};

export const Abierta: Story = {
  args: { open: true, values: { ...createEmptyPaymentFormValues(), amount: "2040" } },
};

/** Tras confirmar con la sección abierta y la transferencia a medias. */
export const Incompleta: Story = {
  args: {
    error: INITIAL_PAYMENT_INCOMPLETE_MESSAGE,
    open: true,
    showErrors: true,
    values: createEmptyPaymentFormValues("transferencia"),
  },
};
