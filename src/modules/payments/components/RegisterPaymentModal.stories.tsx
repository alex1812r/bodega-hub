import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { useState } from "react";
import { expect, waitFor, within } from "storybook/test";

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
 * - Cada envío lleva una clave de idempotencia. Tras un fallo de red, un tiempo
 *   límite o un 5xx el modal queda "por confirmar": campos bloqueados con lo enviado
 *   y "Reintentar", que reenvía lo mismo con la misma clave y no duplica el pago. Si
 *   el reintento vuelve a quedar sin confirmar aparece "Descartar intento".
 * - Tras cada envío la acción principal tarda ~400 ms en aceptar clics (doble clic).
 * - Con un pago en vuelo o por confirmar, un guardia pregunta antes de salir.
 *
 * Estas historias simulan `/api/sales/:id`, `/api/purchases/:id` y `/api/payments`
 * con MSW y abren el modal por código.
 */
const meta = {
  component: RegisterPaymentModal,
  parameters: {
    // El guardia de proceso usa `useRouter` de `next/navigation`: necesita el App Router simulado.
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/purchases/purchase-story" },
    },
  },
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

// Tasa del día de la tienda: con ella se convierte el USD de una compra.
const dayRateVes = 520;

const documentHandlers = [
  paymentMethodsHandler,
  http.get("/api/exchange-rates/current", () =>
    HttpResponse.json({
      data: {
        createdAt: "2026-10-07T12:00:00.000Z",
        id: "rate-story",
        rateVes: dayRateVes,
        source: "BCV",
      },
    }),
  ),
  http.get("/api/purchases/:id", () => HttpResponse.json({ data: purchase })),
  http.get("/api/sales/:id", () => HttpResponse.json({ data: sale })),
];

const registerHandler = http.post("/api/payments", async ({ request }) => {
  const body = (await request.json()) as { amount: number; currency?: "USD" | "VES" };
  const document = "purchaseId" in body ? purchase : sale;
  const rateVes = "purchaseId" in body ? dayRateVes : document.refRateVes;
  const amountVes = body.currency === "USD" ? body.amount * rateVes : body.amount;

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

/**
 * El saldo es Bs 15.000 y la tasa del día 520: 30 USD son Bs 15.600, más que el
 * saldo, así que el monto queda marcado y el pago no se envía.
 */
export const PurchaseUsdOverBalance: Story = {
  name: "Compra en USD mayor al saldo",
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

    await dialog.findByText(/Saldo pendiente actual/);
    await userEvent.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
    await userEvent.type(dialog.getByLabelText("Monto"), "30");
    // El botón espera a la tasa del día antes de dejar enviar un pago en USD.
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Registrar pago" })).toBeEnabled(),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Registrar pago" }));
    await expect(
      await dialog.findByText(/El monto supera el saldo pendiente/),
    ).toBeInTheDocument();
    await expect(dialog.getByLabelText("Monto")).toHaveAttribute("aria-invalid", "true");
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

export const Rejected: Story = {
  name: "Rechazo del servidor (400)",
  parameters: {
    msw: {
      handlers: [
        ...documentHandlers,
        http.post("/api/payments", async () => {
          await delay(400);

          return HttpResponse.json(
            { error: { code: "BAD_REQUEST", message: "La caja está cerrada." } },
            { status: 400 },
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
    await expect(await dialog.findByText("La caja está cerrada.")).toBeInTheDocument();
    // Rechazo definitivo: se sigue editando y se envía con el botón de siempre.
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Registrar pago" })).toBeEnabled(),
    );
    await expect(dialog.getByLabelText("Monto")).toBeEnabled();
  },
};

export const ServerError: Story = {
  name: "Por confirmar tras un error de servidor (500)",
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
    // Resultado incierto: campos bloqueados con lo enviado y "Reintentar" con la misma clave.
    await expect(
      dialog.getByText(
        "No pudimos confirmar si el pago se registró. Reintenta: si ya entró, no se duplicará.",
      ),
    ).toBeInTheDocument();
    await expect(dialog.getByLabelText("Monto")).toBeDisabled();
    // Las acciones del pie tardan un instante en aceptar clics tras el envío.
    await waitFor(() => expect(dialog.getByRole("button", { name: "Reintentar" })).toBeEnabled());
    // Antes del primer reintento fallido no hay forma de descartar.
    await expect(dialog.queryByRole("button", { name: "Descartar intento" })).not.toBeInTheDocument();
  },
};

export const StillUnconfirmedAfterRetry: Story = {
  name: "Por confirmar tras reintentar: se puede descartar",
  parameters: ServerError.parameters,
  render: () => <ModalDemo purchaseId={purchase.id} />,
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole("dialog"));

    await userEvent.click(await dialog.findByRole("button", { name: "Completar saldo" }));
    await userEvent.click(dialog.getByRole("button", { name: "Registrar pago" }));

    const retry = await dialog.findByRole("button", { name: "Reintentar" });

    await waitFor(() => expect(retry).toBeEnabled());
    await userEvent.click(retry);

    const discard = await dialog.findByRole("button", { name: "Descartar intento" });

    await waitFor(() => expect(discard).toBeEnabled());
    await userEvent.click(discard);
    await expect(await body.findByRole("dialog", { name: "Descartar intento" })).toHaveTextContent(
      "No sabemos si se registró el pago",
    );
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
