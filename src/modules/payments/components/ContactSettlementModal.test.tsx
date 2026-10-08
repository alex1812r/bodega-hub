import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { ContactSettlementModal } from "./ContactSettlementModal";

type PostReply = Response | Promise<Response>;

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function errorResponse(status: number, message: string) {
  return jsonResponse({ error: { code: "TEST", message } }, status);
}

function document(
  id: string,
  number: string,
  pendingVes: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    createdAt: "2026-09-01T14:00:00.000Z",
    id,
    number,
    paidVes: 0,
    pendingVes,
    refRateVes: 40,
    status: "pendiente_pago",
    totalRef: pendingVes / 40,
    totalVes: pendingVes,
    type: "sale",
    ...overrides,
  };
}

function renderModal(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ContactSettlementModal", () => {
  const fetchMock = jest.fn();
  let documents: ReturnType<typeof document>[];
  let postReplies: PostReply[];
  let dayRateVes: number;

  beforeEach(() => {
    documents = [
      document("sale-internal-1", "F-0001", 100),
      document("sale-internal-2", "F-0002", 250.5, { createdAt: "2026-09-05T14:00:00.000Z" }),
      document("sale-internal-3", "F-0003", 80, { createdAt: "2026-09-09T14:00:00.000Z" }),
    ];
    postReplies = [];
    dayRateVes = 50;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const reply = postReplies.shift();

        return reply ?? jsonResponse({ data: { ...body, id: `pay-${body.clientRequestId}` } }, 201);
      }

      if (String(url).includes("/api/settings/payment-methods")) {
        return jsonResponse({
          data: {
            enabledPaymentMethods: [
              "efectivo_ves",
              "efectivo_usd",
              "pago_movil",
              "punto_venta",
              "transferencia",
            ],
          },
        });
      }

      if (String(url).includes("/api/exchange-rates/current")) {
        return jsonResponse({
          data: { createdAt: "2026-10-07T12:00:00.000Z", id: "rate-1", rateVes: dayRateVes, source: "BCV" },
        });
      }

      if (String(url).includes("/api/payments/open-documents")) {
        return jsonResponse({
          data: {
            items: documents,
            limit: 100,
            skip: 0,
            total: documents.length,
            totals: {
              count: documents.length,
              pendingVes: documents.reduce((sum, item) => sum + item.pendingVes, 0),
              truncated: false,
            },
          },
        });
      }

      return jsonResponse({ data: null });
    });
    global.fetch = fetchMock;
  });

  function posts() {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
  }

  async function openModal(type: "purchase" | "sale" = "sale", onSettled?: jest.Mock) {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    renderModal(
      <ContactSettlementModal
        contactId="contact-internal-1"
        contactName="Maria Perez"
        onOpenChange={onOpenChange}
        onSettled={onSettled}
        open
        type={type}
      />,
    );

    const dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));

    await waitFor(() =>
      expect(dialog.queryByText("Cargando documentos pendientes...")).not.toBeInTheDocument(),
    );

    return { dialog, onOpenChange, user };
  }

  async function previewAmount(
    dialog: ReturnType<typeof within>,
    user: ReturnType<typeof userEvent.setup>,
    amount: string,
  ) {
    await user.type(dialog.getByLabelText("Monto"), amount);
    await user.click(dialog.getByRole("button", { name: "Ver reparto" }));
  }

  function row(dialog: ReturnType<typeof within>, label: string) {
    return within(dialog.getByRole("listitem", { name: label }));
  }

  it("pide los documentos del contacto por tipo y muestra total y cantidad, sin ids internos", async () => {
    const { dialog } = await openModal();

    const [url] = fetchMock.mock.calls.find(([calledUrl]) =>
      String(calledUrl).includes("/api/payments/open-documents"),
    ) as [string];

    expect(url).toContain("contactId=contact-internal-1");
    expect(url).toContain("type=sale");
    expect(dialog.getByText(formatVesBs(430.5))).toBeInTheDocument();
    expect(dialog.getByText(/3 ventas por cobrar/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/internal/);
  });

  it("muestra el reparto antes de confirmar y no registra nada hasta entonces", async () => {
    const { dialog, user } = await openModal();

    await previewAmount(dialog, user, "390.5");

    const list = within(dialog.getByRole("list", { name: "Reparto del abono" }));

    expect(list.getAllByRole("listitem")).toHaveLength(3);
    expect(row(dialog, "Venta F-0001").getAllByText(formatVesBs(100))).toHaveLength(2);
    expect(row(dialog, "Venta F-0001").getByText(formatVesBs(0))).toBeInTheDocument();
    expect(row(dialog, "Venta F-0001").getByText("01/09/2026")).toBeInTheDocument();
    expect(row(dialog, "Venta F-0003").getByText(formatVesBs(80))).toBeInTheDocument();
    expect(row(dialog, "Venta F-0003").getAllByText(formatVesBs(40))).toHaveLength(2);
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/internal/);
    expect(posts()).toHaveLength(0);

    await user.click(dialog.getByRole("button", { name: "Volver" }));

    expect(dialog.getByLabelText("Monto")).toHaveValue("390.5");
    expect(posts()).toHaveLength(0);
  });

  it("confirma: un pago por documento, en orden, con claves distintas y sin vuelto", async () => {
    const onSettled = jest.fn();
    const { dialog, user } = await openModal("sale", onSettled);

    await previewAmount(dialog, user, "390.5");
    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));

    expect(await dialog.findByText(/Abono registrado: 3 pagos/)).toBeInTheDocument();
    expect(posts()).toEqual([
      expect.objectContaining({ amount: 100, currency: "VES", saleId: "sale-internal-1" }),
      expect.objectContaining({ amount: 250.5, currency: "VES", saleId: "sale-internal-2" }),
      expect.objectContaining({ amount: 40, currency: "VES", saleId: "sale-internal-3" }),
    ]);
    expect(new Set(posts().map((body) => body.clientRequestId)).size).toBe(3);
    posts().forEach((body) => {
      expect(body).not.toHaveProperty("change");
      expect(body).not.toHaveProperty("purchaseId");
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0][0]).toHaveLength(3);
    expect(dialog.queryByRole("button", { name: "Reintentar pendientes" })).not.toBeInTheDocument();
  });

  it("fallo 500 en el 2.º: se detiene, dice qué se registró y reintenta con la MISMA clave", async () => {
    const onSettled = jest.fn();
    const { dialog, user } = await openModal("sale", onSettled);

    postReplies = [
      jsonResponse({ data: { id: "pay-1" } }, 201),
      errorResponse(500, "ERR_UPSTREAM_TIMEOUT"),
    ];
    await previewAmount(dialog, user, "430.5");
    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));

    const alert = within(await dialog.findByRole("alert"));

    expect(row(dialog, "Venta F-0001").getByText("Registrado")).toBeInTheDocument();
    expect(row(dialog, "Venta F-0002").getByText("Falló")).toBeInTheDocument();
    expect(row(dialog, "Venta F-0002").getByText("ERR_UPSTREAM_TIMEOUT")).toBeInTheDocument();
    expect(row(dialog, "Venta F-0003").getByText("Pendiente")).toBeInTheDocument();
    expect(alert.getByText("Se registró 1 de 3 pagos.")).toBeInTheDocument();
    expect(alert.getByText("Registrado: Venta F-0001.")).toBeInTheDocument();
    expect(alert.getByText("Falló: Venta F-0002.")).toBeInTheDocument();
    expect(alert.getByText("Sin enviar: Venta F-0003.")).toBeInTheDocument();
    expect(posts()).toHaveLength(2);
    expect(onSettled).not.toHaveBeenCalled();
    // Resultado incierto: editar cambiaría el contenido y podría duplicar el pago.
    expect(dialog.queryByRole("button", { name: "Volver a editar" })).not.toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Reintentar pendientes" }));

    expect(await dialog.findByText(/Abono registrado: 3 pagos/)).toBeInTheDocument();

    const sent = posts();

    expect(sent.map((body) => body.saleId)).toEqual([
      "sale-internal-1",
      "sale-internal-2",
      "sale-internal-2",
      "sale-internal-3",
    ]);
    expect(sent[2].clientRequestId).toBe(sent[1].clientRequestId);
    expect(sent[2]).toEqual(sent[1]);
    expect(sent[3].clientRequestId).not.toBe(sent[1].clientRequestId);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0][0]).toHaveLength(3);
  });

  it("fallo de red en el 1.º: nada registrado y el reintento conserva la clave", async () => {
    const { dialog, user } = await openModal();

    postReplies = [Promise.reject(new TypeError("Failed to fetch"))];
    await previewAmount(dialog, user, "150");
    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));

    const alert = within(await dialog.findByRole("alert"));

    expect(alert.getByText("Se registraron 0 de 2 pagos.")).toBeInTheDocument();
    expect(alert.queryByText(/^Registrado:/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(1);

    await user.click(dialog.getByRole("button", { name: "Reintentar pendientes" }));

    expect(await dialog.findByText(/Abono registrado: 2 pagos/)).toBeInTheDocument();
    expect(posts()[1].clientRequestId).toBe(posts()[0].clientRequestId);
  });

  it("fallo 400 en el 2.º: muestra el mensaje tal cual y deja volver a editar lo no registrado", async () => {
    const { dialog, user } = await openModal();

    postReplies = [
      jsonResponse({ data: { id: "pay-1" } }, 201),
      errorResponse(400, "No puede registrar un pago en efectivo: no tiene una sesión de caja abierta"),
    ];
    await previewAmount(dialog, user, "430.5");
    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));

    const alert = within(await dialog.findByRole("alert"));

    expect(
      row(dialog, "Venta F-0002").getByText(
        "No puede registrar un pago en efectivo: no tiene una sesión de caja abierta",
      ),
    ).toBeInTheDocument();
    expect(alert.getByText("Se registró 1 de 3 pagos.")).toBeInTheDocument();
    expect(alert.getByText("Sin enviar: Venta F-0003.")).toBeInTheDocument();
    expect(row(dialog, "Venta F-0003").getByText("Pendiente")).toBeInTheDocument();
    expect(posts()).toHaveLength(2);
    expect(dialog.getByRole("button", { name: "Reintentar pendientes" })).toBeEnabled();

    await user.click(dialog.getByRole("button", { name: "Volver a editar" }));

    // Vuelve al paso 1 con lo que quedó sin registrar: 250,50 + 80.
    expect(dialog.getByLabelText("Monto")).toHaveValue("330.5");
    expect(dialog.getByText(/Ya se registró: Venta F-0001\./)).toBeInTheDocument();
    expect(posts()).toHaveLength(2);
  });

  it("sin documentos pendientes: estado vacío y no se puede abonar", async () => {
    documents = [];

    const { dialog } = await openModal();

    expect(dialog.getByText("Maria Perez no tiene ventas por cobrar.")).toBeInTheDocument();
    expect(dialog.queryByLabelText("Monto")).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Ver reparto" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Confirmar abono" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("monto mayor al total pendiente: avisa el sobrante y no deja confirmar", async () => {
    const { dialog, user } = await openModal();

    await previewAmount(dialog, user, "500");

    expect(dialog.getByRole("alert")).toHaveTextContent(formatVesBs(69.5));
    expect(dialog.queryByRole("list", { name: "Reparto del abono" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Confirmar abono" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("sin monto no pasa al reparto", async () => {
    const { dialog, user } = await openModal();

    await user.click(dialog.getByRole("button", { name: "Ver reparto" }));

    expect(dialog.getByText("Indica un monto mayor a cero.")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Confirmar abono" })).not.toBeInTheDocument();
  });

  it("método bancario sin referencia no confirma; con ella, la misma vale para todos los pagos", async () => {
    const { dialog, user } = await openModal();

    await user.selectOptions(dialog.getByLabelText("Metodo"), "punto_venta");
    await previewAmount(dialog, user, "150");

    expect(dialog.getByText("Indica la referencia.")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Confirmar abono" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);

    await user.type(dialog.getByLabelText("Referencia"), "LOTE-77");
    await user.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));

    expect(await dialog.findByText(/Abono registrado: 2 pagos/)).toBeInTheDocument();
    expect(posts()).toEqual([
      expect.objectContaining({ amount: 100, method: "punto_venta", referenceCode: "LOTE-77" }),
      expect.objectContaining({ amount: 50, method: "punto_venta", referenceCode: "LOTE-77" }),
    ]);
  });

  it("completar total pendiente llena el monto con todo lo abonable", async () => {
    const { dialog, user } = await openModal();

    await user.click(dialog.getByRole("button", { name: "Completar total pendiente" }));

    expect(dialog.getByLabelText("Monto")).toHaveValue("430.5");

    await user.click(dialog.getByRole("button", { name: "Ver reparto" }));

    expect(row(dialog, "Venta F-0003").getAllByText(formatVesBs(80))).toHaveLength(2);
  });

  it("doble clic en confirmar: una sola secuencia", async () => {
    const { dialog, user } = await openModal();

    await previewAmount(dialog, user, "430.5");

    const confirm = dialog.getByRole("button", { name: "Confirmar abono" });

    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    expect(await dialog.findByText(/Abono registrado: 3 pagos/)).toBeInTheDocument();
    expect(posts().map((body) => body.saleId)).toEqual([
      "sale-internal-1",
      "sale-internal-2",
      "sale-internal-3",
    ]);
  });

  it("con un pago en vuelo no se cierra, no reenvía y el siguiente espera al anterior", async () => {
    const { dialog, onOpenChange, user } = await openModal();
    let release: (response: Response) => void = () => undefined;

    postReplies = [
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    ];
    await previewAmount(dialog, user, "150");
    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));

    expect(await row(dialog, "Venta F-0001").findByText("Registrando…")).toBeInTheDocument();
    expect(row(dialog, "Venta F-0002").getByText("Pendiente")).toBeInTheDocument();
    // En secuencia: el segundo no sale mientras el primero no responde.
    expect(posts()).toHaveLength(1);
    expect(dialog.getByRole("button", { name: "Cerrar" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Registrando..." })).toBeDisabled();

    await user.keyboard("{Escape}");
    await user.click(dialog.getByRole("button", { name: "Cerrar modal" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(1);

    await act(async () => {
      release(jsonResponse({ data: { id: "pay-1" } }, 201));
    });

    expect(await dialog.findByText(/Abono registrado: 2 pagos/)).toBeInTheDocument();
    expect(posts()).toHaveLength(2);

    await user.click(dialog.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("método en USD: cada venta convierte con su propia tasa y no se paga de más", async () => {
    documents = [
      document("sale-internal-1", "F-0001", 100, { refRateVes: 36.5 }),
      document("sale-internal-2", "F-0002", 400, { refRateVes: 40 }),
    ];

    const { dialog, user } = await openModal();

    await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
    await previewAmount(dialog, user, "7.73");

    // 100 / 36.5 = 2.7397: caben 2.73 USD (Bs 99,65) y quedan Bs 0,35.
    expect(row(dialog, "Venta F-0001").getByText(formatRefUsd(2.73))).toBeInTheDocument();
    expect(row(dialog, "Venta F-0001").getByText(formatVesBs(99.65))).toBeInTheDocument();
    expect(row(dialog, "Venta F-0001").getByText(formatVesBs(0.35))).toBeInTheDocument();
    expect(row(dialog, "Venta F-0002").getByText(formatRefUsd(5))).toBeInTheDocument();
    expect(row(dialog, "Venta F-0002").getAllByText(formatVesBs(200))).toHaveLength(2);

    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));

    expect(await dialog.findByText(/Abono registrado: 2 pagos/)).toBeInTheDocument();
    expect(posts()).toEqual([
      expect.objectContaining({ amount: 2.73, currency: "USD", saleId: "sale-internal-1" }),
      expect.objectContaining({ amount: 5, currency: "USD", saleId: "sale-internal-2" }),
    ]);
  });

  it("compras: paga con purchaseId y en USD convierte con la tasa del día", async () => {
    documents = [
      document("purchase-internal-1", "C-0007", 1000, {
        paidRef: 0,
        pendingRef: 25,
        status: "recibido",
        type: "purchase",
      }),
    ];

    const { dialog, user } = await openModal("purchase");

    expect(dialog.getByText(/1 compra por pagar/)).toBeInTheDocument();

    await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
    await waitFor(() =>
      expect(dialog.queryByText("Cargando la tasa del día...")).not.toBeInTheDocument(),
    );
    await user.click(dialog.getByRole("button", { name: "Completar total pendiente" }));

    // Bs 1000 a la tasa del día (50), no a la de la compra (40).
    expect(dialog.getByLabelText("Monto")).toHaveValue("20");

    await user.click(dialog.getByRole("button", { name: "Ver reparto" }));

    expect(row(dialog, "Compra #C-0007").getByText(formatRefUsd(20))).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));

    expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();
    expect(posts()).toEqual([
      expect.objectContaining({ amount: 20, currency: "USD", purchaseId: "purchase-internal-1" }),
    ]);
    expect(posts()[0]).not.toHaveProperty("saleId");
  });

  it("cerrar y volver a abrir deja el modal limpio en el paso 1", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const ui = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <ContactSettlementModal
          contactId="contact-internal-1"
          contactName="Maria Perez"
          onOpenChange={() => undefined}
          open={open}
          type="sale"
        />
      </QueryClientProvider>
    );
    const user = userEvent.setup();
    const { rerender } = render(ui(true));
    const dialog = within(await screen.findByRole("dialog"));

    await user.type(await dialog.findByLabelText("Monto"), "150");
    await user.click(dialog.getByRole("button", { name: "Ver reparto" }));
    expect(dialog.getByRole("button", { name: "Confirmar abono" })).toBeInTheDocument();

    rerender(ui(false));
    rerender(ui(true));

    const reopened = within(await screen.findByRole("dialog"));

    expect(await reopened.findByLabelText("Monto")).toHaveValue("");
    expect(reopened.queryByRole("button", { name: "Confirmar abono" })).not.toBeInTheDocument();
  });

  it("sin `open` se abre con su propio botón", async () => {
    const user = userEvent.setup();

    renderModal(
      <ContactSettlementModal contactId="contact-internal-1" contactName="Maria Perez" type="sale" />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abonar" }));

    expect(await screen.findByRole("dialog", { name: "Abonar" })).toBeInTheDocument();
  });
});
