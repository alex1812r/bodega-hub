import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { STEP_CLICK_GUARD_MS } from "../hooks/useStepClickGuard";
import { ContactSettlementModal } from "./ContactSettlementModal";

// El guardia de proceso (`useProcessGuard`) usa el router de la app.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

type MockProfile = { storeId: string | null; user: { id: string } };

const ADMIN_PROFILE: MockProfile = { storeId: "store-1", user: { id: "user-admin" } };
const SELLER_PROFILE: MockProfile = { storeId: "store-1", user: { id: "user-seller" } };
// PAG-F8: el abono guardado es de la sesión (tienda y usuario) que lo dejó.
const mockAuth: { profile: MockProfile | undefined } = { profile: ADMIN_PROFILE };

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ profile: mockAuth.profile }),
}));

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

// PAG-F10: los flujos que pulsan varios botones del pie esperan en tiempo real la guarda
// de doble clic (~700 ms por paso); con la suite completa en paralelo no caben en 5 s.
jest.setTimeout(20_000);

describe("ContactSettlementModal", () => {
  const fetchMock = jest.fn();
  let documents: ReturnType<typeof document>[];
  let postReplies: PostReply[];
  let dayRateVes: number;
  /** Si está puesta, la lista de documentos no responde hasta que se resuelva. */
  let documentsGate: Promise<void> | null;

  beforeEach(() => {
    window.sessionStorage.clear();
    mockAuth.profile = ADMIN_PROFILE;
    documentsGate = null;
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
        await documentsGate;

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

  function documentRequests() {
    return fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/payments/open-documents"),
    ).length;
  }

  /** Modal con su propio botón "Abonar", como lo monta la pestaña Saldos. */
  function renderWithTrigger(queryClient?: QueryClient) {
    const ui = (
      <ContactSettlementModal contactId="contact-internal-1" contactName="Maria Perez" type="sale" />
    );

    return queryClient
      ? render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
      : renderModal(ui);
  }

  async function clickAbonar(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Abonar" }));

    return within(await screen.findByRole("dialog", { name: "Abonar" }));
  }

  /**
   * PAG-F8: tras cada envío las acciones del pie quedan deshabilitadas ~700 ms. Como
   * haría el usuario, se pulsa el botón cuando ya está habilitado.
   */
  async function press(
    dialog: ReturnType<typeof within>,
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ) {
    const button = await dialog.findByRole("button", { name });

    await waitFor(() => expect(button).toBeEnabled());
    await stepSettled(dialog);
    await user.click(button);
  }

  /**
   * PAG-F9: tras cada cambio de paso el pie ignora los clics ~700 ms (el botón lo
   * anuncia con `aria-disabled`). Como haría el usuario, se espera a que pase.
   */
  async function stepSettled(dialog: ReturnType<typeof within>) {
    await waitFor(() =>
      expect(
        dialog
          .queryAllByRole("button")
          .filter((button: HTMLElement) => button.getAttribute("aria-disabled") === "true"),
      ).toHaveLength(0),
    );
  }

  /**
   * PAG-F9: recién abierta, la confirmación de descarte ignora ~700 ms el clic en su
   * botón de confirmar y no lo anuncia (es de `ConfirmActionModal`): se deja pasar.
   */
  async function discardGuardSettled() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, STEP_CLICK_GUARD_MS));
    });
  }

  async function closeDialog(
    dialog: ReturnType<typeof within>,
    user: ReturnType<typeof userEvent.setup>,
  ) {
    await press(dialog, user, "Cerrar");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }

  /** Clic en un enlace de la app que sale de la pantalla (lo que intercepta el guardia). */
  function clickLinkToAnotherRoute() {
    const link = window.document.createElement("a");

    link.href = "/payments";
    link.textContent = "Pagos";
    // jsdom no navega: se cancela después de que el guardia (en captura) lo haya visto.
    link.addEventListener("click", (event) => event.preventDefault());
    window.document.body.append(link);
    fireEvent.click(link);
    link.remove();
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
    await stepSettled(dialog);
    await user.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await stepSettled(dialog);
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

    await press(dialog, user, "Volver");

    expect(dialog.getByLabelText("Monto")).toHaveValue("390.5");
    expect(posts()).toHaveLength(0);
  });

  it("confirma: un pago por documento, en orden, con claves distintas y sin vuelto", async () => {
    const onSettled = jest.fn();
    const { dialog, user } = await openModal("sale", onSettled);

    await previewAmount(dialog, user, "390.5");
    await press(dialog, user, "Confirmar abono");

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
    await press(dialog, user, "Confirmar abono");

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

    await press(dialog, user, "Reintentar pendientes");

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
    await press(dialog, user, "Confirmar abono");

    const alert = within(await dialog.findByRole("alert"));

    expect(alert.getByText("Se registraron 0 de 2 pagos.")).toBeInTheDocument();
    expect(alert.queryByText(/^Registrado:/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(1);

    await press(dialog, user, "Reintentar pendientes");

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
    await press(dialog, user, "Confirmar abono");

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
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Reintentar pendientes" })).toBeEnabled(),
    );

    await press(dialog, user, "Volver a editar");

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

    await press(dialog, user, "Ver reparto");

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
    await press(dialog, user, "Ver reparto");
    await press(dialog, user, "Confirmar abono");

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

    await press(dialog, user, "Ver reparto");

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
    await press(dialog, user, "Confirmar abono");

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

    await press(dialog, user, "Cerrar");
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

    await press(dialog, user, "Confirmar abono");

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

    await press(dialog, user, "Ver reparto");

    expect(row(dialog, "Compra #C-0007").getByText(formatRefUsd(20))).toBeInTheDocument();

    await press(dialog, user, "Confirmar abono");

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
    await press(dialog, user, "Ver reparto");
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

  describe("PAG-F7 · abono por confirmar", () => {
    const UNCERTAIN_TEXT =
      "No pudimos confirmar si este pago se registró. Reintenta: si ya entró, no se duplicará.";

    it("U1: 500 con el pago guardado → Cerrar → Abonar de nuevo: no sale un POST con clave nueva", async () => {
      documents = [document("sale-internal-1", "F-0001", 8475)];
      // El servidor guardó el pago, pero al navegador le llega un 500.
      postReplies = [errorResponse(500, "ERR_RESPONSE_LOST")];

      const user = userEvent.setup();

      renderWithTrigger();

      let dialog = await clickAbonar(user);

      await previewAmount(dialog, user, "100");
      await press(dialog, user, "Confirmar abono");
      await dialog.findByRole("alert");
      documents = [document("sale-internal-1", "F-0001", 8375, { paidVes: 100 })];

      await closeDialog(dialog, user);
      dialog = await clickAbonar(user);

      // Abre directamente en el abono por confirmar: no hay formulario para otro abono.
      expect(dialog.queryByLabelText("Monto")).not.toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Ver reparto" })).not.toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Confirmar abono" })).not.toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Volver a editar" })).not.toBeInTheDocument();
      expect(row(dialog, "Venta F-0001").getByText("Falló")).toBeInTheDocument();
      expect(dialog.getByText(UNCERTAIN_TEXT)).toBeInTheDocument();

      await press(dialog, user, "Reintentar pendientes");

      expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();

      const sent = posts();

      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(sent[0]);
      expect(new Set(sent.map((body) => body.clientRequestId)).size).toBe(1);
      // Resuelto: ya no queda nada guardado y el siguiente "Abonar" es uno nuevo.
      expect(window.sessionStorage).toHaveLength(0);

      await closeDialog(dialog, user);
      dialog = await clickAbonar(user);

      expect(await dialog.findByLabelText("Monto")).toHaveValue("");
    });

    it("U1: el abono por confirmar sobrevive a recargar la página, con las mismas claves", async () => {
      postReplies = [jsonResponse({ data: { id: "pay-1" } }, 201), errorResponse(503, "ERR_GATEWAY")];

      const user = userEvent.setup();
      const first = renderWithTrigger();
      let dialog = await clickAbonar(user);

      await previewAmount(dialog, user, "150");
      await press(dialog, user, "Confirmar abono");
      await dialog.findByRole("alert");
      first.unmount();

      renderWithTrigger();
      dialog = await clickAbonar(user);

      expect(row(dialog, "Venta F-0001").getByText("Registrado")).toBeInTheDocument();
      expect(row(dialog, "Venta F-0002").getByText("Falló")).toBeInTheDocument();
      expect(row(dialog, "Venta F-0002").getByText("ERR_GATEWAY")).toBeInTheDocument();
      expect(dialog.getByText(UNCERTAIN_TEXT)).toBeInTheDocument();
      expect(dialog.queryByLabelText("Monto")).not.toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Volver a editar" })).not.toBeInTheDocument();

      await press(dialog, user, "Reintentar pendientes");

      expect(await dialog.findByText(/Abono registrado: 2 pagos por/)).toBeInTheDocument();

      const sent = posts();

      // No se reenvía el ya registrado; el incierto viaja idéntico, con su clave.
      expect(sent.map((body) => body.saleId)).toEqual([
        "sale-internal-1",
        "sale-internal-2",
        "sale-internal-2",
      ]);
      expect(sent[2]).toEqual(sent[1]);
      expect(window.sessionStorage).toHaveLength(0);
    });

    it("U1: un reintento que termina en rechazo definitivo libera el abono (se puede editar)", async () => {
      postReplies = [
        errorResponse(500, "ERR_RESPONSE_LOST"),
        errorResponse(400, "La venta no tiene saldo pendiente: ya está cobrada"),
      ];

      const { dialog, user } = await openModal();

      await previewAmount(dialog, user, "100");
      await press(dialog, user, "Confirmar abono");
      await dialog.findByText(UNCERTAIN_TEXT);
      expect(window.sessionStorage).toHaveLength(1);

      await press(dialog, user, "Reintentar pendientes");

      await waitFor(() =>
        expect(dialog.getByRole("button", { name: "Volver a editar" })).toBeEnabled(),
      );
      expect(dialog.queryByText(UNCERTAIN_TEXT)).not.toBeInTheDocument();
    });

    it("punto 3: tras un fallo incierto se vuelven a pedir los documentos con saldo", async () => {
      const { dialog, user } = await openModal();

      postReplies = [errorResponse(500, "ERR_RESPONSE_LOST")];
      await previewAmount(dialog, user, "100");

      const before = documentRequests();

      await press(dialog, user, "Confirmar abono");
      await dialog.findByRole("alert");

      await waitFor(() => expect(documentRequests()).toBeGreaterThan(before));
    });

    it("punto 3: al abrir vuelve a pedir la lista aunque la caché sea reciente y no deja ver el reparto con datos viejos", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
      });
      const user = userEvent.setup();

      renderWithTrigger(queryClient);

      let dialog = await clickAbonar(user);

      expect(await dialog.findByText(/3 ventas por cobrar/)).toBeInTheDocument();
      expect(documentRequests()).toBe(1);

      await user.click(dialog.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      // Otro usuario cobró dos de las tres ventas.
      documents = [document("sale-internal-1", "F-0001", 100)];

      let release: () => void = () => undefined;

      documentsGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      dialog = await clickAbonar(user);

      await waitFor(() => expect(documentRequests()).toBe(2));
      expect(dialog.getByRole("button", { name: "Ver reparto" })).toBeDisabled();
      expect(dialog.getByText("Actualizando saldos...")).toBeInTheDocument();

      await act(async () => {
        release();
      });

      await waitFor(() => expect(dialog.getByRole("button", { name: "Ver reparto" })).toBeEnabled());
      expect(dialog.getByText(/1 venta por cobrar/)).toBeInTheDocument();
      expect(dialog.queryByText("Actualizando saldos...")).not.toBeInTheDocument();
    });

    it("U5: tras un 400 definitivo refresca la lista y «Volver a editar» reparte con los saldos frescos", async () => {
      const { dialog, user } = await openModal();

      postReplies = [errorResponse(400, "La venta no tiene saldo pendiente: ya está cobrada")];
      await previewAmount(dialog, user, "150");

      const before = documentRequests();

      await press(dialog, user, "Confirmar abono");
      await dialog.findByRole("alert");
      // Otra pestaña cobró F-0001: ya no tiene saldo.
      documents = documents.filter((item) => item.id !== "sale-internal-1");
      await waitFor(() => expect(documentRequests()).toBeGreaterThan(before));

      await press(dialog, user, "Volver a editar");

      expect(dialog.getByLabelText("Monto")).toHaveValue("150");
      await waitFor(() => expect(dialog.getByRole("button", { name: "Ver reparto" })).toBeEnabled());
      await press(dialog, user, "Ver reparto");

      const list = within(dialog.getByRole("list", { name: "Reparto del abono" }));

      expect(list.getAllByRole("listitem")).toHaveLength(1);
      expect(list.queryByRole("listitem", { name: "Venta F-0001" })).not.toBeInTheDocument();
      expect(row(dialog, "Venta F-0002").getByText(formatVesBs(150))).toBeInTheDocument();

      await press(dialog, user, "Confirmar abono");

      expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();
      expect(posts().map((body) => [body.saleId, body.amount])).toEqual([
        ["sale-internal-1", 100],
        ["sale-internal-2", 150],
      ]);
    });

    it("U5: tras un rechazo definitivo se puede continuar con los documentos no enviados", async () => {
      const onSettled = jest.fn();
      const { dialog, user } = await openModal("sale", onSettled);

      postReplies = [errorResponse(400, "La venta no tiene saldo pendiente: ya está cobrada")];
      await previewAmount(dialog, user, "150");
      await press(dialog, user, "Confirmar abono");
      await dialog.findByRole("alert");

      await press(dialog, user, "Continuar con los demás");

      expect(await row(dialog, "Venta F-0002").findByText("Registrado")).toBeInTheDocument();
      expect(row(dialog, "Venta F-0001").getByText("Falló")).toBeInTheDocument();
      // El rechazado no se reenvía; el siguiente sale con su propia clave.
      expect(posts().map((body) => body.saleId)).toEqual(["sale-internal-1", "sale-internal-2"]);
      expect(posts()[1].clientRequestId).not.toBe(posts()[0].clientRequestId);
      expect(onSettled).not.toHaveBeenCalled();
      expect(
        dialog.queryByRole("button", { name: "Continuar con los demás" }),
      ).not.toBeInTheDocument();
    });

    it("U6: si el modal se desmonta a mitad de la secuencia no salen más pagos y lo pendiente queda guardado", async () => {
      let release: (response: Response) => void = () => undefined;

      postReplies = [
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      ];

      const user = userEvent.setup();
      const first = renderWithTrigger();
      let dialog = await clickAbonar(user);

      await previewAmount(dialog, user, "430.5");
      await press(dialog, user, "Confirmar abono");
      await row(dialog, "Venta F-0001").findByText("Registrando…");
      first.unmount();

      await act(async () => {
        release(jsonResponse({ data: { id: "pay-1" } }, 201));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // El que estaba en vuelo terminó; los otros dos no se enviaron sin pantalla.
      expect(posts()).toHaveLength(1);

      renderWithTrigger();
      dialog = await clickAbonar(user);

      expect(row(dialog, "Venta F-0001").getByText("Registrado")).toBeInTheDocument();
      expect(row(dialog, "Venta F-0002").getByText("Pendiente")).toBeInTheDocument();
      expect(row(dialog, "Venta F-0003").getByText("Pendiente")).toBeInTheDocument();
      expect(dialog.getByRole("alert")).toHaveTextContent(
        "Sin enviar: Venta F-0002, Venta F-0003.",
      );

      await press(dialog, user, "Reintentar pendientes");

      expect(await dialog.findByText(/Abono registrado: 3 pagos por/)).toBeInTheDocument();
      expect(posts().map((body) => body.saleId)).toEqual([
        "sale-internal-1",
        "sale-internal-2",
        "sale-internal-3",
      ]);
    });

    it("U6: el guardia pregunta al salir con el abono en vuelo o por confirmar, y no con el formulario limpio ni tras el éxito", async () => {
      const { dialog, user } = await openModal();
      const guardDialog = () => screen.queryByRole("dialog", { name: "¿Salir sin terminar?" });

      clickLinkToAnotherRoute();
      expect(guardDialog()).not.toBeInTheDocument();

      // CNF-15: con un monto tecleado pregunta el guardia de datos sin registrar, que nombra el cobro.
      await user.type(dialog.getByLabelText("Monto"), "100");
      clickLinkToAnotherRoute();
      expect(
        await screen.findByRole("dialog", { name: "¿Salir sin terminar?" }),
      ).toHaveTextContent("Cobro de Bs. 100,00 a Maria Perez sin registrar");
      await user.click(screen.getByRole("button", { name: "Seguir aquí" }));
      await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());

      let release: (response: Response) => void = () => undefined;

      postReplies = [
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      ];
      await press(dialog, user, "Ver reparto");
      await press(dialog, user, "Confirmar abono");
      await row(dialog, "Venta F-0001").findByText("Registrando…");

      // En vuelo.
      clickLinkToAnotherRoute();
      expect(
        await screen.findByRole("dialog", { name: "¿Salir sin terminar?" }),
      ).toHaveTextContent("Abono en curso");
      await user.click(screen.getByRole("button", { name: "Seguir aquí" }));
      await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());

      // Por confirmar.
      await act(async () => {
        release(errorResponse(500, "ERR_RESPONSE_LOST"));
      });
      await dialog.findByRole("alert");
      clickLinkToAnotherRoute();
      expect(
        await screen.findByRole("dialog", { name: "¿Salir sin terminar?" }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Seguir aquí" }));
      await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());

      // Terminado con éxito.
      await press(dialog, user, "Reintentar pendientes");
      expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();
      clickLinkToAnotherRoute();
      expect(guardDialog()).not.toBeInTheDocument();
    });

    it("bajo: un fallo de red se muestra en español, no con el texto del navegador", async () => {
      const { dialog, user } = await openModal();

      postReplies = [Promise.reject(new TypeError("Failed to fetch"))];
      await previewAmount(dialog, user, "100");
      await press(dialog, user, "Confirmar abono");
      await dialog.findByRole("alert");

      expect(
        row(dialog, "Venta F-0001").getByText("No se pudo conectar con el servidor."),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Abonar" })).not.toHaveTextContent(
        "Failed to fetch",
      );
    });

    it("bajo: un 400 de validación muestra el primer motivo que trae el error", async () => {
      const { dialog, user } = await openModal();

      postReplies = [
        jsonResponse(
          {
            error: {
              code: "BAD_REQUEST",
              issues: [
                { message: "El texto no puede superar 2000 caracteres", path: ["notes"] },
                { message: "Otro motivo", path: ["referenceCode"] },
              ],
              message: "La solicitud no tiene un formato valido.",
            },
          },
          400,
        ),
      ];
      await previewAmount(dialog, user, "100");
      await press(dialog, user, "Confirmar abono");
      await dialog.findByRole("alert");

      expect(
        row(dialog, "Venta F-0001").getByText(
          "La solicitud no tiene un formato valido. El texto no puede superar 2000 caracteres",
        ),
      ).toBeInTheDocument();
    });

    describe("PAG-F8 · N1: abono por confirmar con salida", () => {
      const DISCARD = "Descartar abono por confirmar";
      const KEY_CONFLICT = "La clave de idempotencia ya se usó en otro pago.";

      async function confirmOneUncertain(replies: PostReply[]) {
        documents = [document("sale-internal-1", "F-0001", 8475)];
        postReplies = replies;

        const user = userEvent.setup();
        const view = renderWithTrigger();
        const dialog = await clickAbonar(user);

        await previewAmount(dialog, user, "100");
        await press(dialog, user, "Confirmar abono");
        await dialog.findByText(UNCERTAIN_TEXT);

        return { dialog, user, view };
      }

      it("a) un 409 al REINTENTAR es rechazo definitivo: muestra el mensaje, refresca saldos y deja de estar por confirmar", async () => {
        const { dialog, user } = await confirmOneUncertain([
          errorResponse(500, "ERR_RESPONSE_LOST"),
          errorResponse(409, KEY_CONFLICT),
        ]);
        const before = documentRequests();

        await press(dialog, user, "Reintentar pendientes");

        expect(await row(dialog, "Venta F-0001").findByText(KEY_CONFLICT)).toBeInTheDocument();
        await waitFor(() => expect(dialog.queryByText(UNCERTAIN_TEXT)).not.toBeInTheDocument());
        await waitFor(() => expect(documentRequests()).toBeGreaterThan(before));
        expect(await dialog.findByRole("button", { name: "Volver a editar" })).toBeInTheDocument();
        expect(dialog.queryByRole("button", { name: DISCARD })).not.toBeInTheDocument();

        const sent = posts();

        expect(sent).toHaveLength(2);
        expect(sent[1]).toEqual(sent[0]);

        // Ya no está por confirmar: cerrar lo suelta y "Abonar" abre un formulario nuevo.
        await closeDialog(dialog, user);
        expect(window.sessionStorage).toHaveLength(0);
        expect(await (await clickAbonar(user)).findByLabelText("Monto")).toHaveValue("");
      });

      it("a) tras ese rechazo, reintentar la misma fila con otro 409 no la devuelve a «por confirmar»", async () => {
        const { dialog, user } = await confirmOneUncertain([
          errorResponse(500, "ERR_RESPONSE_LOST"),
          errorResponse(409, KEY_CONFLICT),
          errorResponse(409, KEY_CONFLICT),
        ]);

        await press(dialog, user, "Reintentar pendientes");
        await dialog.findByRole("button", { name: "Volver a editar" });
        await press(dialog, user, "Reintentar pendientes");
        await waitFor(() => expect(posts()).toHaveLength(3));

        await waitFor(() =>
          expect(dialog.getByRole("button", { name: "Volver a editar" })).toBeEnabled(),
        );
        expect(dialog.queryByText(UNCERTAIN_TEXT)).not.toBeInTheDocument();
        expect(new Set(posts().map((body) => body.clientRequestId)).size).toBe(1);
      });

      it("a) un 409 en el PRIMER envío sigue siendo de resultado incierto", async () => {
        const { dialog } = await confirmOneUncertain([errorResponse(409, KEY_CONFLICT)]);

        expect(dialog.queryByRole("button", { name: "Volver a editar" })).not.toBeInTheDocument();
        expect(dialog.queryByRole("button", { name: DISCARD })).not.toBeInTheDocument();
        expect(window.sessionStorage).toHaveLength(1);
      });

      it("b) «Descartar» no se ofrece antes del primer reintento fallido y sí después, también tras recargar", async () => {
        const { dialog, user, view } = await confirmOneUncertain([
          errorResponse(500, "ERR_RESPONSE_LOST"),
          errorResponse(503, "ERR_GATEWAY"),
        ]);

        expect(dialog.queryByRole("button", { name: DISCARD })).not.toBeInTheDocument();

        await press(dialog, user, "Reintentar pendientes");

        expect(await dialog.findByRole("button", { name: DISCARD })).toBeInTheDocument();
        expect(dialog.getByText(UNCERTAIN_TEXT)).toBeInTheDocument();
        expect(dialog.queryByRole("button", { name: "Volver a editar" })).not.toBeInTheDocument();
        expect(posts()[1]).toEqual(posts()[0]);

        view.unmount();
        renderWithTrigger();

        const reopened = await clickAbonar(user);

        expect(reopened.getByRole("button", { name: DISCARD })).toBeInTheDocument();
        expect(reopened.getByRole("button", { name: "Reintentar pendientes" })).toBeInTheDocument();
      });

      it("b) descartar pide confirmación con documento y monto; al confirmar limpia lo guardado, refresca y vuelve al formulario con clave nueva", async () => {
        const { dialog, user } = await confirmOneUncertain([
          errorResponse(500, "ERR_RESPONSE_LOST"),
          Promise.reject(new TypeError("Failed to fetch")),
        ]);

        await press(dialog, user, "Reintentar pendientes");
        await press(dialog, user, DISCARD);

        let confirm = within(await screen.findByRole("dialog", { name: DISCARD }));

        expect(confirm.getByText(/Venta F-0001/)).toHaveTextContent(formatVesBs(100));
        expect(confirm.getByText(/Maria Perez/)).toHaveTextContent(/duplicado/);

        // Cancelar no descarta nada.
        await user.click(confirm.getByRole("button", { name: "Cancelar" }));
        await waitFor(() =>
          expect(screen.queryByRole("dialog", { name: DISCARD })).not.toBeInTheDocument(),
        );
        expect(window.sessionStorage).toHaveLength(1);
        expect(dialog.getByText(UNCERTAIN_TEXT)).toBeInTheDocument();
        expect(posts()).toHaveLength(2);

        // El pago incierto sí había entrado: el saldo fresco ya lo descuenta.
        documents = [document("sale-internal-1", "F-0001", 8375, { paidVes: 100 })];

        const before = documentRequests();

        await press(dialog, user, DISCARD);
        confirm = within(await screen.findByRole("dialog", { name: DISCARD }));
        await discardGuardSettled();
        await user.click(confirm.getByRole("button", { name: "Descartar abono" }));

        await waitFor(() =>
          expect(screen.queryByRole("dialog", { name: DISCARD })).not.toBeInTheDocument(),
        );
        expect(await dialog.findByLabelText("Monto")).toHaveValue("");
        expect(window.sessionStorage).toHaveLength(0);
        await waitFor(() => expect(documentRequests()).toBeGreaterThan(before));
        expect(await dialog.findByText(formatVesBs(8375))).toBeInTheDocument();
        // Descartar no envía nada.
        expect(posts()).toHaveLength(2);

        // Sin nada por confirmar ya no hay guardia al salir.
        clickLinkToAnotherRoute();
        expect(
          screen.queryByRole("dialog", { name: "¿Salir sin terminar?" }),
        ).not.toBeInTheDocument();

        await waitFor(() => expect(dialog.getByRole("button", { name: "Ver reparto" })).toBeEnabled());
        await previewAmount(dialog, user, "50");
        await press(dialog, user, "Confirmar abono");
        expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();

        const sent = posts();

        expect(sent).toHaveLength(3);
        expect(sent[2].amount).toBe(50);
        expect(sent[2].clientRequestId).not.toBe(sent[0].clientRequestId);
      });
    });

    describe("PAG-F8 · bajos", () => {
      it("doble clic: recién terminado un envío las acciones del pie no aceptan clics y luego sí", async () => {
        const { dialog, user } = await openModal();

        postReplies = [errorResponse(400, "La venta no tiene saldo pendiente: ya está cobrada")];
        await previewAmount(dialog, user, "150");
        await press(dialog, user, "Confirmar abono");
        await dialog.findByRole("alert");

        const names = ["Cerrar", "Volver a editar", "Continuar con los demás", "Reintentar pendientes"];

        for (const name of names) {
          expect(dialog.getByRole("button", { name })).toBeDisabled();
        }

        // El segundo clic de un doble clic no hace nada: ni cierra, ni edita, ni envía.
        await user.click(dialog.getByRole("button", { name: "Volver a editar" }));
        await user.click(dialog.getByRole("button", { name: "Cerrar" }));
        expect(dialog.queryByLabelText("Monto")).not.toBeInTheDocument();
        expect(screen.getByRole("dialog", { name: "Abonar" })).toBeInTheDocument();
        expect(posts()).toHaveLength(1);

        for (const name of names) {
          await waitFor(() => expect(dialog.getByRole("button", { name })).toBeEnabled());
        }
      });

      it("sessionStorage: otro usuario en la misma pestaña no ve ni reenvía el abono por confirmar de otro", async () => {
        documents = [document("sale-internal-1", "F-0001", 8475)];
        postReplies = [errorResponse(500, "ERR_RESPONSE_LOST")];

        const user = userEvent.setup();
        const admin = renderWithTrigger();
        let dialog = await clickAbonar(user);

        await previewAmount(dialog, user, "100");
        await press(dialog, user, "Confirmar abono");
        await dialog.findByText(UNCERTAIN_TEXT);
        admin.unmount();

        mockAuth.profile = SELLER_PROFILE;

        const seller = renderWithTrigger();

        dialog = await clickAbonar(user);
        expect(await dialog.findByLabelText("Monto")).toHaveValue("");
        expect(dialog.queryByText(UNCERTAIN_TEXT)).not.toBeInTheDocument();
        expect(posts()).toHaveLength(1);
        seller.unmount();

        // Sigue ahí para quien lo dejó.
        mockAuth.profile = ADMIN_PROFILE;
        renderWithTrigger();
        dialog = await clickAbonar(user);
        expect(dialog.getByText(UNCERTAIN_TEXT)).toBeInTheDocument();
      });

      it("sessionStorage: si la sesión se conoce después de montar, retoma el abono guardado", async () => {
        documents = [document("sale-internal-1", "F-0001", 8475)];
        postReplies = [errorResponse(500, "ERR_RESPONSE_LOST")];

        const user = userEvent.setup();
        const first = renderWithTrigger();
        const dialog = await clickAbonar(user);

        await previewAmount(dialog, user, "100");
        await press(dialog, user, "Confirmar abono");
        await dialog.findByText(UNCERTAIN_TEXT);
        first.unmount();

        mockAuth.profile = undefined;

        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const view = renderWithTrigger(queryClient);

        mockAuth.profile = ADMIN_PROFILE;
        view.rerender(
          <QueryClientProvider client={queryClient}>
            <ContactSettlementModal
              contactId="contact-internal-1"
              contactName="Maria Perez"
              type="sale"
            />
          </QueryClientProvider>,
        );

        const reopened = await clickAbonar(user);

        expect(reopened.getByText(UNCERTAIN_TEXT)).toBeInTheDocument();
        expect(reopened.queryByLabelText("Monto")).not.toBeInTheDocument();
      });
    });

    it("bajo: un monto que no supera el máximo pero no se puede repartir dice qué montos sí se pueden abonar", async () => {
      documents = [document("sale-internal-1", "F-0001", 8475)];

      const { dialog, user } = await openModal();

      await previewAmount(dialog, user, "8474.99");

      const alert = dialog.getByRole("alert");

      expect(alert).not.toHaveTextContent("supera");
      expect(alert).toHaveTextContent(formatVesBs(8474.98));
      expect(alert).toHaveTextContent(`máximo abonable, ${formatVesBs(8475)}`);
      expect(dialog.queryByRole("button", { name: "Confirmar abono" })).not.toBeInTheDocument();
    });

    it("bajo: un monto mayor que lo abonable dice cuánto es lo máximo abonable", async () => {
      const { dialog, user } = await openModal();

      await previewAmount(dialog, user, "500");

      expect(dialog.getByRole("alert")).toHaveTextContent(
        `Máximo abonable: ${formatVesBs(430.5)}`,
      );
    });

    describe("PAG-F9 · doble clic que ejecuta la acción del paso siguiente", () => {
      const DISCARD = "Descartar abono por confirmar";

      beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
      });

      afterEach(() => {
        act(() => {
          jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
      });

      function advance(ms: number) {
        act(() => {
          jest.advanceTimersByTime(ms);
        });
      }

      /** Clic en el fondo del diálogo de arriba; el cierre del modal sale en el siguiente tick. */
      function pressOutside() {
        const overlays = window.document.querySelectorAll("div.fixed.inset-0");

        fireEvent.pointerDown(overlays[overlays.length - 1]);
        advance(1);
      }

      /** CNF-15: con el monto tecleado, cerrar pregunta antes; devuelve la pregunta del guardia. */
      function leaveQuestion() {
        return screen.getByRole("dialog", { name: "¿Salir sin terminar?" });
      }

      /** Responde a la pregunta del guardia y deja pasar su cierre. */
      async function answerLeaveQuestion(answer: "Salir" | "Seguir aquí") {
        fireEvent.click(within(leaveQuestion()).getByRole("button", { name: answer }));
        await act(async () => {
          await Promise.resolve();
        });
        advance(1);
      }

      async function openOnForm(amount: string) {
        documents = [document("sale-internal-1", "F-0001", 8475)];

        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        const onOpenChange = jest.fn();

        renderModal(
          <ContactSettlementModal
            contactId="contact-internal-1"
            contactName="Maria Perez"
            onOpenChange={onOpenChange}
            open
            type="sale"
          />,
        );

        const dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));

        await waitFor(() => expect(dialog.getByRole("button", { name: "Ver reparto" })).toBeEnabled());
        await user.type(dialog.getByLabelText("Monto"), amount);

        return { dialog, onOpenChange, user };
      }

      /** Abono por confirmar con «Descartar» a la vista y ya pasada la espera del envío. */
      async function openOnDiscardable() {
        postReplies = [
          errorResponse(500, "ERR_RESPONSE_LOST"),
          errorResponse(503, "ERR_GATEWAY"),
        ];

        const opened = await openOnForm("100");
        const { dialog } = opened;

        fireEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
        advance(STEP_CLICK_GUARD_MS);
        fireEvent.click(dialog.getByRole("button", { name: "Confirmar abono" }));
        await dialog.findByText(UNCERTAIN_TEXT);
        await waitFor(() =>
          expect(dialog.getByRole("button", { name: "Reintentar pendientes" })).toBeEnabled(),
        );
        fireEvent.click(dialog.getByRole("button", { name: "Reintentar pendientes" }));
        await waitFor(() => expect(posts()).toHaveLength(2));
        await waitFor(() => expect(dialog.getByRole("button", { name: DISCARD })).toBeEnabled());

        return opened;
      }

      it("F1: doble clic en «Ver reparto» se queda en el reparto con 0 POST; pasada la espera «Confirmar abono» registra", async () => {
        const { dialog } = await openOnForm("100");

        // Abrir y teclear no arman la espera: el primer clic entra sin demora.
        fireEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
        // El segundo clic cae en el botón que ocupa el mismo sitio.
        fireEvent.click(dialog.getByRole("button", { name: "Confirmar abono" }));

        expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();
        expect(posts()).toHaveLength(0);

        // 300 ms: la separación más larga que midió QA.
        advance(300);
        fireEvent.click(dialog.getByRole("button", { name: "Confirmar abono" }));
        expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();
        expect(posts()).toHaveLength(0);

        // PAG-F10: el clic ignorado rearmó la espera; cuenta desde él.
        advance(STEP_CLICK_GUARD_MS);
        fireEvent.click(dialog.getByRole("button", { name: "Confirmar abono" }));

        expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();
        expect(posts()).toHaveLength(1);
      });

      it("F1: doble clic en «Volver» no cancela el abono; el botón conserva el foco y luego responde", async () => {
        const { dialog, onOpenChange } = await openOnForm("100");

        fireEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
        advance(STEP_CLICK_GUARD_MS);

        const back = dialog.getByRole("button", { name: "Volver" });

        back.focus();
        fireEvent.click(back);
        // «Cancelar» ocupa ahora el sitio de «Volver».
        fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
        advance(1);

        expect(onOpenChange).not.toHaveBeenCalled();
        expect(dialog.getByLabelText("Monto")).toHaveValue("100");
        // Sin `disabled`: el botón conserva el foco y el teclado sigue sirviendo después.
        expect(dialog.getByRole("button", { name: "Cancelar" })).toHaveFocus();
        expect(dialog.getByRole("button", { name: "Cancelar" })).toBeEnabled();

        advance(STEP_CLICK_GUARD_MS);
        fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
        advance(1);
        // CNF-15: el botón ya responde; con el monto tecleado, cerrar pregunta antes.
        expect(leaveQuestion()).toHaveTextContent("Cobro de Bs. 100,00 a Maria Perez sin registrar");
        expect(onOpenChange).not.toHaveBeenCalled();
        await answerLeaveQuestion("Salir");
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });

      it("F3: el segundo clic cae fuera tras «Ver reparto»: el modal sigue abierto con su reparto; Esc no espera y, pasada la espera, clic fuera cierra", async () => {
        const { dialog, onOpenChange } = await openOnForm("100");

        fireEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
        advance(120);
        pressOutside();

        expect(onOpenChange).not.toHaveBeenCalled();
        expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();

        // Esc no espera: el cierre se atiende y, con el monto tecleado, pregunta (CNF-15).
        fireEvent.keyDown(screen.getByRole("dialog", { name: "Abonar" }), { key: "Escape" });
        advance(1);
        expect(leaveQuestion()).toBeInTheDocument();
        await answerLeaveQuestion("Seguir aquí");
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();

        advance(STEP_CLICK_GUARD_MS);
        pressOutside();
        await answerLeaveQuestion("Salir");
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
      });

      it("F3: recién registrado al reintentar, el segundo clic cae fuera y «Abono registrado» sigue a la vista", async () => {
        postReplies = [errorResponse(500, "ERR_RESPONSE_LOST")];

        const { dialog, onOpenChange } = await openOnForm("100");

        fireEvent.click(dialog.getByRole("button", { name: "Ver reparto" }));
        advance(STEP_CLICK_GUARD_MS);
        fireEvent.click(dialog.getByRole("button", { name: "Confirmar abono" }));
        await dialog.findByText(UNCERTAIN_TEXT);
        await waitFor(() =>
          expect(dialog.getByRole("button", { name: "Reintentar pendientes" })).toBeEnabled(),
        );

        fireEvent.click(dialog.getByRole("button", { name: "Reintentar pendientes" }));
        // Respuesta rápida: llega en pocos milisegundos, muy por debajo de la espera.
        await dialog.findByText(/Abono registrado: 1 pago por/, undefined, { interval: 5 });
        pressOutside();

        expect(onOpenChange).not.toHaveBeenCalled();
        expect(dialog.getByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();
      });

      it("F2: doble clic en «Descartar abono por confirmar» deja la confirmación abierta sin descartar; pasada la espera sí descarta", async () => {
        const { dialog } = await openOnDiscardable();

        fireEvent.click(dialog.getByRole("button", { name: DISCARD }));

        const confirm = within(screen.getByRole("dialog", { name: DISCARD }));

        // El segundo clic cae en el botón de confirmar.
        fireEvent.click(confirm.getByRole("button", { name: "Descartar abono" }));
        await act(async () => {
          await Promise.resolve();
        });

        expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
        expect(window.sessionStorage).toHaveLength(1);
        // El clic ignorado no deja el botón en «Procesando...».
        expect(confirm.getByRole("button", { name: "Descartar abono" })).toBeEnabled();

        advance(STEP_CLICK_GUARD_MS);
        fireEvent.click(confirm.getByRole("button", { name: "Descartar abono" }));

        await waitFor(() =>
          expect(screen.queryByRole("dialog", { name: DISCARD })).not.toBeInTheDocument(),
        );
        expect(window.sessionStorage).toHaveLength(0);
        expect(posts()).toHaveLength(2);
      });

      it("F3: el segundo clic cae fuera tras «Descartar abono por confirmar»: la confirmación sigue abierta; pasada la espera, clic fuera la cierra sin descartar", async () => {
        const { dialog } = await openOnDiscardable();

        fireEvent.click(dialog.getByRole("button", { name: DISCARD }));
        // La separación típica de un doble clic (QA: 120 ms).
        advance(120);
        pressOutside();

        expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
        expect(window.sessionStorage).toHaveLength(1);

        advance(STEP_CLICK_GUARD_MS);
        pressOutside();
        await waitFor(() =>
          expect(screen.queryByRole("dialog", { name: DISCARD })).not.toBeInTheDocument(),
        );
        expect(window.sessionStorage).toHaveLength(1);
      });

      describe("PAG-F10 · la ráfaga de clics no atraviesa la guarda", () => {
        /** Clic de ratón completo: la pulsación llega aunque el botón no acepte el clic. */
        function click(element: HTMLElement) {
          fireEvent.pointerDown(element);
          fireEvent.click(element);
        }

        /**
         * Enter sobre un botón como lo entrega el navegador: lo activa (clic) en cada
         * `keydown`, también los de auto-repetición, salvo que alguien lo cancele.
         */
        function pressEnter(element: HTMLElement, repeat = false) {
          if (fireEvent.keyDown(element, { key: "Enter", repeat })) {
            fireEvent.click(element);
          }
        }

        async function settle() {
          await act(async () => {
            await Promise.resolve();
          });
        }

        it("R1: doble clic a 450 ms en «Ver reparto» no confirma y rearma la espera; tras el lapso en calma «Confirmar abono» registra", async () => {
          const { dialog } = await openOnForm("100");

          click(dialog.getByRole("button", { name: "Ver reparto" }));
          advance(450);
          click(dialog.getByRole("button", { name: "Confirmar abono" }));

          expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();
          expect(posts()).toHaveLength(0);

          // Rearmada desde el clic ignorado: otros 450 ms tampoco bastan.
          advance(450);
          click(dialog.getByRole("button", { name: "Confirmar abono" }));
          expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();
          expect(posts()).toHaveLength(0);

          advance(STEP_CLICK_GUARD_MS - 1);
          expect(dialog.getByRole("button", { name: "Confirmar abono" })).toHaveAttribute(
            "aria-disabled",
            "true",
          );

          advance(1);
          click(dialog.getByRole("button", { name: "Confirmar abono" }));

          expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();
          expect(posts()).toHaveLength(1);
        });

        it("R1: clics cada 200 ms sobre «Ver reparto»: ninguno confirma el abono", async () => {
          const { dialog } = await openOnForm("100");

          click(dialog.getByRole("button", { name: "Ver reparto" }));

          for (let extra = 0; extra < 6; extra += 1) {
            advance(200);
            click(dialog.getByRole("button", { name: "Confirmar abono" }));
          }

          await settle();
          expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();
          expect(posts()).toHaveLength(0);
        });

        it("R3: el clic a 450 ms cae fuera tras «Ver reparto» y rearma: el siguiente tampoco cierra; tras el lapso en calma, sí", async () => {
          const { dialog, onOpenChange } = await openOnForm("100");

          click(dialog.getByRole("button", { name: "Ver reparto" }));
          advance(450);
          pressOutside();
          advance(450);
          pressOutside();

          expect(onOpenChange).not.toHaveBeenCalled();
          expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();

          advance(STEP_CLICK_GUARD_MS);
          pressOutside();
          // CNF-15: el cierre ya se atiende; con el monto tecleado pregunta antes.
          await answerLeaveQuestion("Salir");
          expect(onOpenChange).toHaveBeenCalledWith(false);
        });

        it("R2: doble clic a 450 ms en «Descartar abono por confirmar» no descarta y rearma; tras el lapso en calma sí descarta", async () => {
          const { dialog } = await openOnDiscardable();

          click(dialog.getByRole("button", { name: DISCARD }));

          const confirm = within(screen.getByRole("dialog", { name: DISCARD }));

          advance(450);
          click(confirm.getByRole("button", { name: "Descartar abono" }));
          await settle();
          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
          expect(window.sessionStorage).toHaveLength(1);

          advance(450);
          click(confirm.getByRole("button", { name: "Descartar abono" }));
          await settle();
          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
          expect(window.sessionStorage).toHaveLength(1);

          advance(STEP_CLICK_GUARD_MS);
          click(confirm.getByRole("button", { name: "Descartar abono" }));

          await waitFor(() =>
            expect(screen.queryByRole("dialog", { name: DISCARD })).not.toBeInTheDocument(),
          );
          expect(window.sessionStorage).toHaveLength(0);
        });

        it("R2: clics cada 200 ms sobre «Descartar abono por confirmar»: ninguno descarta", async () => {
          const { dialog } = await openOnDiscardable();

          click(dialog.getByRole("button", { name: DISCARD }));

          const confirm = within(screen.getByRole("dialog", { name: DISCARD }));

          for (let extra = 0; extra < 6; extra += 1) {
            advance(200);
            click(confirm.getByRole("button", { name: "Descartar abono" }));
            await settle();
          }

          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
          expect(window.sessionStorage).toHaveLength(1);
        });

        it("R3: el clic a 450 ms cae fuera de la confirmación de descarte y rearma: sigue abierta", async () => {
          const { dialog } = await openOnDiscardable();

          click(dialog.getByRole("button", { name: DISCARD }));
          advance(450);
          pressOutside();
          advance(450);
          pressOutside();

          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
          expect(window.sessionStorage).toHaveLength(1);
        });

        it("R5: Enter mantenido 1 s sobre «Ver reparto» enseña el reparto y no confirma; soltar y pulsar de nuevo sí", async () => {
          const { dialog } = await openOnForm("100");

          pressEnter(dialog.getByRole("button", { name: "Ver reparto" }));

          // Auto-repetición del teclado: una cada ~30 ms mientras la tecla sigue pulsada.
          for (let elapsed = 0; elapsed < 1000; elapsed += 30) {
            advance(30);
            pressEnter(dialog.getByRole("button", { name: "Confirmar abono" }), true);
          }

          await settle();
          expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();
          expect(posts()).toHaveLength(0);

          pressEnter(dialog.getByRole("button", { name: "Confirmar abono" }));
          expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();
          expect(posts()).toHaveLength(1);
        });

        it("R5: Enter mantenido sobre el confirmar de descarte no descarta", async () => {
          const { dialog } = await openOnDiscardable();

          pressEnter(dialog.getByRole("button", { name: DISCARD }));

          const confirm = within(screen.getByRole("dialog", { name: DISCARD }));

          for (let elapsed = 0; elapsed < 1000; elapsed += 30) {
            advance(30);
            pressEnter(confirm.getByRole("button", { name: "Descartar abono" }), true);
          }

          await settle();
          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
          expect(window.sessionStorage).toHaveLength(1);
        });
      });
    });
  });
});
