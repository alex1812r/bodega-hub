import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { useState } from "react";
import { expect, within } from "storybook/test";

import { Button } from "@/shared/components/Button";

import { RegisterPaymentModal, type RegisterPaymentModalProps } from "./RegisterPaymentModal";

/**
 * Modal para pagar una compra o cobrar una venta desde su propia pantalla.
 *
 * - El documento se fija con `purchaseId` o `saleId`: el título, el botón de envío y
 *   la descripción (número del documento y contacto) salen de ahí.
 * - Se abre con `trigger` o por código con `open` + `onOpenChange` ("Pagar ahora").
 * - `onRegistered(payment)` avisa de cada pago registrado; el modal sigue abierto
 *   con el saldo que queda.
 * - Cada envío lleva una clave de idempotencia: reintentar tras un fallo de red o
 *   un 5xx no registra el pago dos veces.
 *
 * Estas historias simulan `/api/sales/:id`, `/api/purchases/:id` y `/api/payments`
 * con MSW y abren el modal por código.
 */
const meta = {
  component: RegisterPaymentModal,
  tags: ["ai-generated"],
} satisfies Meta<typeof RegisterPaymentModal>;

export default meta;
type Story = StoryObj;

const purchase = {
  id: "purchase-story",
  paidVes: 5200,
  purchaseNumber: "C-000128",
  refRateVes: 500,
  supplier: { id: "cont-supplier", name: "Distribuidora Polar" },
  totalVes: 20200,
};

const sale = {
  customer: { id: "cont-customer", name: "María Pérez" },
  id: "sale-story",
  invoiceNumber: "F-000342",
  paidVes: 3000,
  refRateVes: 510,
  totalVes: 11475,
};

const paymentMethodsHandler = http.get("/api/settings/payment-methods", () =>
  HttpResponse.json({
    data: {
      enabledPaymentMethods: [
        "efectivo_ves",
        "efectivo_usd",
        "pago_movil",
        "punto_venta",
        "transferencia",
      ],
    },
  }),
);

const documentHandlers = [
  paymentMethodsHandler,
  http.get("/api/purchases/:id", () => HttpResponse.json({ data: purchase })),
  http.get("/api/sales/:id", () => HttpResponse.json({ data: sale })),
];

const registerHandler = http.post("/api/payments", async ({ request }) => {
  const body = (await request.json()) as { amount: number; currency?: "USD" | "VES" };
  const document = "purchaseId" in body ? purchase : sale;
  const amountVes = body.currency === "USD" ? body.amount * document.refRateVes : body.amount;

  await delay(400);

  return HttpResponse.json(
    {
      data: {
        ...body,
        id: "pay-story",
        pendingBalanceVes: Math.max(document.totalVes - document.paidVes - amountVes, 0),
      },
    },
    { status: 201 },
  );
});

function ModalDemo(props: RegisterPaymentModalProps) {
  const [open, setOpen] = useState(true);
  const [registered, setRegistered] = useState(0);

  return (
    <div className="grid justify-items-start gap-3">
      <Button onClick={() => setOpen(true)} size="sm" type="button">
        Abrir de nuevo
      </Button>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Pagos registrados: {registered}
      </p>
      <RegisterPaymentModal
        {...props}
        onOpenChange={setOpen}
        onRegistered={() => setRegistered((count) => count + 1)}
        open={open}
      />
    </div>
  );
}

export const PurchaseWithBalance: Story = {
  name: "Compra con saldo",
  parameters: {
    msw: { handlers: [...documentHandlers, registerHandler] },
  },
  render: () => <ModalDemo purchaseId={purchase.id} />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", {
        name: "Pagar compra",
      }),
    );

    await expect(
      await dialog.findByText("Compra C-000128 a Distribuidora Polar."),
    ).toBeInTheDocument();
    await userEvent.click(await dialog.findByRole("button", { name: "Completar saldo" }));
    await userEvent.click(dialog.getByRole("button", { name: "Registrar pago" }));
    await expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
  },
};

export const SaleWithBalance: Story = {
  name: "Venta con saldo",
  parameters: {
    msw: { handlers: [...documentHandlers, registerHandler] },
  },
  render: () => <ModalDemo saleId={sale.id} />,
  play: async ({ canvasElement }) => {
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", {
        name: "Cobrar saldo",
      }),
    );

    await expect(await dialog.findByText("Venta F-000342 de María Pérez.")).toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: "Registrar cobro" })).toBeEnabled();
  },
};

export const ServerError: Story = {
  name: "Error de servidor",
  parameters: {
    msw: {
      handlers: [
        ...documentHandlers,
        http.post("/api/payments", async () => {
          await delay(400);

          return HttpResponse.json(
            { error: { code: "INTERNAL", message: "No se pudo registrar el pago." } },
            { status: 500 },
          );
        }),
      ],
    },
  },
  render: () => <ModalDemo purchaseId={purchase.id} />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));

    await userEvent.click(await dialog.findByRole("button", { name: "Completar saldo" }));
    await userEvent.click(dialog.getByRole("button", { name: "Registrar pago" }));
    await expect(await dialog.findByText("No se pudo registrar el pago.")).toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: "Registrar pago" })).toBeEnabled();
  },
};

export const BalanceLoading: Story = {
  name: "Saldo cargando",
  parameters: {
    msw: {
      handlers: [
        paymentMethodsHandler,
        http.get("/api/sales/:id", async () => {
          await delay("infinite");

          return HttpResponse.json({ data: sale });
        }),
      ],
    },
  },
  render: () => <ModalDemo saleId={sale.id} />,
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));

    await expect(await dialog.findByText("Cargando saldo pendiente...")).toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: "Registrar cobro" })).toBeDisabled();
  },
};
