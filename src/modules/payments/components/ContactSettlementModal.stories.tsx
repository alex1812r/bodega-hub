import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { useState } from "react";
import { expect, waitFor, within } from "storybook/test";

import { Button } from "@/shared/components/Button";

import {
  ContactSettlementModal,
  type ContactSettlementModalProps,
} from "./ContactSettlementModal";

/**
 * Modal "Abonar": un abono de un contacto repartido entre sus documentos con saldo,
 * del más antiguo al más nuevo.
 *
 * - Paso 1: total pendiente, método y monto ("Completar total pendiente" lo llena).
 * - Paso 2: el reparto por documento (saldo, se abona, queda) ANTES de confirmar.
 * - Al confirmar registra un pago por documento, en secuencia. Si uno falla se
 *   detiene, dice qué quedó registrado y ofrece "Reintentar pendientes" (misma clave
 *   de idempotencia: no duplica). Tras un rechazo definitivo (4xx) deja volver a editar
 *   o continuar con los documentos que no se enviaron.
 * - Tras un fallo incierto (red, 5xx) el abono queda "por confirmar": solo se puede
 *   reintentar, y sigue ahí al cerrar y volver a abrir (y al recargar: se guarda en
 *   `sessionStorage` por tienda, usuario, contacto y tipo). Si el reintento vuelve a
 *   quedar sin confirmar aparece "Descartar abono por confirmar", con confirmación.
 * - Tras cada cambio de paso o de estado (ver el reparto, volver, fin de un envío,
 *   confirmación de descarte recién abierta) el modal ignora ~700 ms los clics en las
 *   acciones y los cierres por clic fuera: un doble clic no ejecuta el paso siguiente.
 * - Un monto mayor que lo abonable no se confirma: no hay vuelto ni sobrepago.
 * - `type="purchase"`: montarlo solo si el usuario puede pagar compras (admin, contador).
 *
 * Las historias simulan `/api/payments/open-documents`, la tasa del día y
 * `/api/payments` con MSW y abren el modal por código.
 */
const meta = {
  // Un abono sin terminar de una historia no debe reaparecer en la siguiente. Se
  // guarda por tienda y usuario: se borran los de cualquier sesión.
  beforeEach: () => {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith("bodegahub:abono-pendiente:")) {
        window.sessionStorage.removeItem(key);
      }
    }
  },
  component: ContactSettlementModal,
  tags: ["ai-generated"],
} satisfies Meta<typeof ContactSettlementModal>;

export default meta;
type Story = StoryObj;

function openDocument(
  id: string,
  number: string,
  createdAt: string,
  pendingVes: number,
  refRateVes: number,
  type: "purchase" | "sale" = "sale",
) {
  return {
    createdAt,
    id,
    number,
    paidVes: 0,
    pendingVes,
    refRateVes,
    status: type === "sale" ? "pendiente_pago" : "recibido",
    totalRef: pendingVes / refRateVes,
    totalVes: pendingVes,
    type,
  };
}

const sales = [
  openDocument("sale-story-1", "F-000310", "2026-08-12T15:00:00.000Z", 4380, 146),
  openDocument("sale-story-2", "F-000327", "2026-09-03T15:00:00.000Z", 12650.75, 151.5),
  openDocument("sale-story-3", "F-000342", "2026-09-28T15:00:00.000Z", 3120, 156),
];

const purchases = [
  openDocument("purchase-story-1", "C-000118", "2026-08-20T15:00:00.000Z", 46800, 150, "purchase"),
  openDocument("purchase-story-2", "C-000128", "2026-09-18T15:00:00.000Z", 20200, 155, "purchase"),
];

function listHandler(items: ReturnType<typeof openDocument>[]) {
  return http.get("/api/payments/open-documents", () =>
    HttpResponse.json({
      data: {
        items,
        limit: 100,
        skip: 0,
        total: items.length,
        totals: {
          count: items.length,
          pendingVes: items.reduce((sum, item) => sum + item.pendingVes, 0),
          truncated: false,
        },
      },
    }),
  );
}

const baseHandlers = [
  http.get("/api/settings/payment-methods", () =>
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
  ),
  http.get("/api/exchange-rates/current", () =>
    HttpResponse.json({
      data: { createdAt: "2026-10-07T12:00:00.000Z", id: "rate-story", rateVes: 158, source: "BCV" },
    }),
  ),
];

const registerHandler = http.post("/api/payments", async ({ request }) => {
  const body = (await request.json()) as { clientRequestId: string };

  await delay(500);

  return HttpResponse.json({ data: { ...body, id: `pay-${body.clientRequestId}` } }, { status: 201 });
});

/** Registra el primer pago y rechaza el segundo con `status`. */
function failSecondHandler(status: number, message: string) {
  const seen: string[] = [];

  return http.post("/api/payments", async ({ request }) => {
    const body = (await request.json()) as { clientRequestId: string };

    if (!seen.includes(body.clientRequestId)) {
      seen.push(body.clientRequestId);
    }

    await delay(500);

    if (seen.indexOf(body.clientRequestId) === 1) {
      return HttpResponse.json({ error: { code: "STORY", message } }, { status });
    }

    return HttpResponse.json({ data: { ...body, id: `pay-${body.clientRequestId}` } }, { status: 201 });
  });
}

function ModalDemo(props: Omit<ContactSettlementModalProps, "contactId">) {
  const [open, setOpen] = useState(true);
  const [settled, setSettled] = useState(0);

  return (
    <div className="grid justify-items-start gap-3">
      <Button onClick={() => setOpen(true)} size="sm" type="button">
        Abrir de nuevo
      </Button>
      <p className="text-sm text-slate-600 dark:text-slate-300">Abonos completos: {settled}</p>
      <ContactSettlementModal
        {...props}
        contactId="contact-story"
        onOpenChange={setOpen}
        onSettled={() => setSettled((count) => count + 1)}
        open={open}
      />
    </div>
  );
}

async function findDialog(canvasElement: HTMLElement) {
  return within(
    await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Abonar" }),
  );
}

/** Recién mostrado el reparto, "Confirmar abono" ignora los clics ~700 ms (doble clic). */
async function confirmSettlement(
  dialog: Awaited<ReturnType<typeof findDialog>>,
  userEvent: { click: (element: Element) => Promise<void> },
) {
  const button = dialog.getByRole("button", { name: "Confirmar abono" });

  await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  await userEvent.click(button);
}

export const SalesPreview: Story = {
  name: "Cobro: reparto antes de confirmar",
  parameters: { msw: { handlers: [...baseHandlers, listHandler(sales), registerHandler] } },
  render: () => <ModalDemo contactName="María Pérez" type="sale" />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = await findDialog(canvasElement);

    await expect(await dialog.findByText(/3 ventas por cobrar/)).toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText("Monto"), "10000");
    await userEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await expect(dialog.getByRole("listitem", { name: "Venta F-000310" })).toBeInTheDocument();
    await expect(dialog.getByRole("listitem", { name: "Venta F-000327" })).toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: "Confirmar abono" })).toBeEnabled();
  },
};

export const SalesSettled: Story = {
  name: "Cobro: abono completo registrado",
  parameters: { msw: { handlers: [...baseHandlers, listHandler(sales), registerHandler] } },
  render: () => <ModalDemo contactName="María Pérez" type="sale" />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = await findDialog(canvasElement);

    await userEvent.click(
      await dialog.findByRole("button", { name: "Completar total pendiente" }),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await confirmSettlement(dialog, userEvent);
    await expect(
      await dialog.findByText(/Abono registrado: 3 pagos/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  },
};

export const UsdDifferentRates: Story = {
  name: "Cobro en USD: una tasa por venta",
  parameters: { msw: { handlers: [...baseHandlers, listHandler(sales), registerHandler] } },
  render: () => <ModalDemo contactName="María Pérez" type="sale" />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = await findDialog(canvasElement);

    await userEvent.selectOptions(await dialog.findByLabelText("Metodo"), "efectivo_usd");
    await userEvent.type(dialog.getByLabelText("Monto"), "100");
    await userEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await expect(dialog.getByRole("listitem", { name: "Venta F-000327" })).toBeInTheDocument();
  },
};

export const StoppedByServerError: Story = {
  name: "Fallo incierto en el 2.º pago (500)",
  parameters: {
    msw: {
      handlers: [
        ...baseHandlers,
        listHandler(sales),
        failSecondHandler(500, "No se pudo registrar el pago."),
      ],
    },
  },
  render: () => <ModalDemo contactName="María Pérez" type="sale" />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = await findDialog(canvasElement);

    await userEvent.click(
      await dialog.findByRole("button", { name: "Completar total pendiente" }),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await confirmSettlement(dialog, userEvent);
    await expect(
      await dialog.findByText("Se registró 1 de 3 pagos.", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    // Las acciones del pie tardan un instante en aceptar clics tras el envío.
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Reintentar pendientes" })).toBeEnabled(),
    );
    // Por confirmar: ni editar ni continuar, solo reintentar con la misma clave.
    await expect(dialog.queryByRole("button", { name: "Volver a editar" })).not.toBeInTheDocument();
    await expect(
      dialog.getByText(
        "No pudimos confirmar si este pago se registró. Reintenta: si ya entró, no se duplicará.",
      ),
    ).toBeInTheDocument();
  },
};

export const StoppedByRejection: Story = {
  name: "Rechazo definitivo en el 2.º pago (400)",
  parameters: {
    msw: {
      handlers: [
        ...baseHandlers,
        listHandler(sales),
        failSecondHandler(
          400,
          "No puede registrar un pago en efectivo: no tiene una sesión de caja abierta en su caja asignada",
        ),
      ],
    },
  },
  render: () => <ModalDemo contactName="María Pérez" type="sale" />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = await findDialog(canvasElement);

    await userEvent.click(
      await dialog.findByRole("button", { name: "Completar total pendiente" }),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await confirmSettlement(dialog, userEvent);
    const edit = await dialog.findByRole("button", { name: "Volver a editar" }, { timeout: 5000 });

    await waitFor(() => expect(edit).toBeEnabled());
  },
};

export const StillUnconfirmedAfterRetry: Story = {
  name: "Por confirmar tras reintentar: se puede descartar",
  parameters: {
    msw: {
      handlers: [
        ...baseHandlers,
        listHandler(sales),
        http.post("/api/payments", async () => {
          await delay(300);

          return HttpResponse.json(
            { error: { code: "STORY", message: "No se pudo registrar el pago." } },
            { status: 503 },
          );
        }),
      ],
    },
  },
  render: () => <ModalDemo contactName="María Pérez" type="sale" />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = await findDialog(canvasElement);

    await userEvent.type(await dialog.findByLabelText("Monto"), "1000");
    await userEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await confirmSettlement(dialog, userEvent);

    const retry = await dialog.findByRole("button", { name: "Reintentar pendientes" });

    // Antes del primer reintento fallido no hay forma de descartar.
    await waitFor(() => expect(retry).toBeEnabled());
    await expect(
      dialog.queryByRole("button", { name: "Descartar abono por confirmar" }),
    ).not.toBeInTheDocument();
    await userEvent.click(retry);

    const discard = await dialog.findByRole(
      "button",
      { name: "Descartar abono por confirmar" },
      { timeout: 5000 },
    );

    await waitFor(() => expect(discard).toBeEnabled());
    await userEvent.click(discard);
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", {
        name: "Descartar abono por confirmar",
      }),
    ).toHaveTextContent("Venta F-000310");
  },
};

export const AmountAboveTotal: Story = {
  name: "Monto mayor que el total pendiente",
  parameters: { msw: { handlers: [...baseHandlers, listHandler(sales), registerHandler] } },
  render: () => <ModalDemo contactName="María Pérez" type="sale" />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = await findDialog(canvasElement);

    await userEvent.type(await dialog.findByLabelText("Monto"), "99999");
    await userEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await expect(dialog.getByRole("alert")).toHaveTextContent(/sobran/);
    await expect(dialog.queryByRole("button", { name: "Confirmar abono" })).not.toBeInTheDocument();
  },
};

export const NoPendingDocuments: Story = {
  name: "Sin documentos pendientes",
  parameters: { msw: { handlers: [...baseHandlers, listHandler([]), registerHandler] } },
  render: () => <ModalDemo contactName="María Pérez" type="sale" />,
  play: async ({ canvasElement }) => {
    const dialog = await findDialog(canvasElement);

    await expect(
      await dialog.findByText("María Pérez no tiene ventas por cobrar."),
    ).toBeInTheDocument();
    await expect(dialog.queryByRole("button", { name: "Ver reparto" })).not.toBeInTheDocument();
  },
};

export const PurchasesUsd: Story = {
  name: "Pago a proveedor en USD (tasa del día)",
  parameters: { msw: { handlers: [...baseHandlers, listHandler(purchases), registerHandler] } },
  render: () => <ModalDemo contactName="Distribuidora Polar" type="purchase" />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = await findDialog(canvasElement);

    await expect(await dialog.findByText(/2 compras por pagar/)).toBeInTheDocument();
    await userEvent.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
    await userEvent.click(
      await dialog.findByRole("button", { name: "Completar total pendiente" }),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await expect(dialog.getByRole("listitem", { name: "Compra #C-000118" })).toBeInTheDocument();
  },
};
