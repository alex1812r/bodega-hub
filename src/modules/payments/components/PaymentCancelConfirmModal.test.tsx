/**
 * CNF-06 · «Anular pago» confirma con su efecto exacto. Los impact de estos tests
 * salen de `computePaymentImpact` (el mismo cálculo que sirve el endpoint), no de
 * cifras escritas a mano.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  computePaymentImpact,
  type PaymentImpact,
  type PaymentImpactInputs,
} from "../services/paymentImpact";
import { PaymentCancelConfirmModal } from "./PaymentCancelConfirmModal";

type Inputs = PaymentImpactInputs;
type FullLedger = Extract<Inputs["ledger"], { kind: "full" }>;

const salePayment: Inputs["payment"] = {
  amount: 1000,
  amountRef: 2,
  amountVes: 1000,
  changeMethod: null,
  changeRef: 0,
  changeVes: 0,
  currency: "VES",
  id: "pay-001",
  method: "efectivo_ves",
  status: "activo",
};

const sale: Inputs["document"] = {
  contactName: "Cliente Demo",
  id: "sale-1",
  kind: "sale",
  number: "V-000002",
  paidVes: 1000,
  status: "pagada",
  totalVes: 1000,
};

const purchase: Inputs["document"] = {
  contactName: "Proveedor Demo",
  id: "purchase-1",
  kind: "purchase",
  number: "C-000009",
  paidRef: 2,
  paidVes: 1000,
  status: "recibido",
  totalRef: 4,
  totalVes: 2000,
};

function ledger(overrides: Partial<FullLedger> = {}): FullLedger {
  return {
    cashMovements: [],
    kind: "full",
    vault: { balanceEfectivoVes: 800, balanceRef: 10, balanceVes: 5000, id: "vault-1" },
    vaultMovements: [],
    ...overrides,
  };
}

const openCashSaleIn = {
  amountRef: 0,
  amountVes: 1000,
  registerName: "Caja 1",
  sessionStatus: "open" as const,
  type: "sale_in",
  vaultTransferredAt: null,
};

function impactOf(overrides: Partial<Inputs> = {}): PaymentImpact {
  return computePaymentImpact({
    action: "cancel",
    canCancelPayments: true,
    document: sale,
    ledger: ledger({ cashMovements: [openCashSaleIn] }),
    payment: salePayment,
    ...overrides,
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("PaymentCancelConfirmModal", () => {
  const fetchMock = jest.fn();
  let impactResponse: () => Promise<Response>;

  beforeEach(() => {
    impactResponse = async () => jsonResponse({ data: impactOf() });
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => impactResponse());
    global.fetch = fetchMock;
  });

  function renderModal(
    props: Partial<React.ComponentProps<typeof PaymentCancelConfirmModal>> = {},
  ) {
    const onConfirm = jest.fn();
    const onOpenChange = jest.fn();
    const queryClient = new QueryClient();
    const modal = (extra: typeof props = {}) => (
      <QueryClientProvider client={queryClient}>
        <PaymentCancelConfirmModal
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
          open
          paymentId="pay-001"
          {...props}
          {...extra}
        />
      </QueryClientProvider>
    );
    const view = render(modal());

    return { onConfirm, onOpenChange, rerender: (extra: typeof props) => view.rerender(modal(extra)) };
  }

  /** Fila de «Qué va a pasar» que contiene ese texto. */
  function effectRow(text: string | RegExp) {
    const row = screen.getByText(text).closest("li");

    if (!row) {
      throw new Error(`No hay fila de efecto para ${String(text)}`);
    }

    return row;
  }

  it("pide el impact de ese pago y, mientras carga, no ofrece anular", async () => {
    let resolveImpact: (response: Response) => void = () => undefined;

    impactResponse = () =>
      new Promise<Response>((resolve) => {
        resolveImpact = resolve;
      });
    renderModal();

    const loadingDialog = await screen.findByRole("dialog");
    const dialog = within(loadingDialog);

    expect(dialog.getByRole("status")).toHaveTextContent("Calculando el efecto de anular el pago");
    expect(dialog.getByRole("status")).toHaveTextContent("Hasta conocerlo no se puede anular.");
    expect(dialog.queryByRole("button", { name: "Anular pago" })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Cerrar" })).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/payments/pay-001/impact?action=cancel");

    resolveImpact(jsonResponse({ data: impactOf() }));

    expect(await screen.findByRole("button", { name: "Anular pago" })).toBeEnabled();
    // CNF-S1: el mismo diálogo de principio a fin, no uno de carga y otro de confirmación.
    expect(screen.getByRole("dialog")).toBe(loadingDialog);
  });

  it("cobro en efectivo: documento, método, monto, la caja de la que sale y la venta antes → después", async () => {
    renderModal();

    await screen.findByRole("button", { name: "Anular pago" });
    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent("Se anula el cobro: salen Bs. 1.000,00 de la caja «Caja 1».");
    expect(dialog).toHaveTextContent("VentaV-000002");
    expect(dialog).toHaveTextContent("ClienteCliente Demo");
    expect(dialog).toHaveTextContent("MétodoEfectivo VES");
    expect(dialog).toHaveTextContent("MontoBs. 1.000,00 (ref 2.00)");

    expect(effectRow("Estado del pago")).toHaveTextContent("Activo");
    expect(effectRow("Estado del pago")).toHaveTextContent("Anulado");
    expect(effectRow("Estado del pago")).toHaveAttribute("data-tone", "danger");
    // Anular un cobro SACA el dinero de la caja; la gaveta no trae saldo antes → después.
    expect(effectRow("Sale de la caja «Caja 1»: −Bs. 1.000,00")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(effectRow("Pagado de la venta V-000002")).toHaveTextContent(
      /Bs\. 1\.000,00.*pasa a.*Bs\. 0,00/,
    );
    expect(effectRow("Saldo pendiente")).toHaveTextContent(/Bs\. 0,00.*pasa a.*Bs\. 1\.000,00/);
    expect(effectRow("Estado de la venta")).toHaveTextContent(/Pagada.*pasa a.*Pendiente de pago/);
  });

  it("es de peligro: el foco inicial queda en «Cancelar» y no pide palabra tecleada", async () => {
    renderModal();

    await screen.findByRole("button", { name: "Anular pago" });

    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus());
    expect(screen.queryByLabelText("Palabra de confirmación")).not.toBeInTheDocument();
  });

  it("pago a proveedor en efectivo: vuelve al baúl con saldo antes → después y la compra no cambia de estado", async () => {
    impactResponse = async () =>
      jsonResponse({
        data: impactOf({
          document: purchase,
          ledger: ledger({
            vaultMovements: [
              { amountRef: 2, amountVes: 0, id: "vm-1", type: "purchase_out", vaultId: "vault-1" },
            ],
          }),
          payment: { ...salePayment, amount: 2, currency: "USD", method: "efectivo_usd" },
        }),
      });
    renderModal();

    await screen.findByRole("button", { name: "Anular pago" });
    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent("CompraC-000009");
    expect(dialog).toHaveTextContent("ProveedorProveedor Demo");
    expect(dialog).toHaveTextContent("Montoref 2.00 (Bs. 1.000,00)");
    expect(effectRow("Vuelve al baúl (efectivo REF): +ref 2.00")).toHaveTextContent(
      /ref 10\.00.*pasa a.*ref 12\.00/,
    );
    expect(effectRow("Pagado de la compra C-000009")).toHaveTextContent(
      /Bs\. 1\.000,00.*pasa a.*Bs\. 0,00/,
    );
    expect(effectRow("Pagado (REF)")).toHaveTextContent(/ref 2\.00.*pasa a.*ref 0\.00/);
    expect(effectRow("Saldo pendiente (REF)")).toHaveTextContent(/ref 2\.00.*pasa a.*ref 4\.00/);
    expect(effectRow("Estado de la compra (no cambia)")).toHaveTextContent("Recibido");
  });

  it("D22: el recorte del baúl a 0 se muestra tal cual, en tono de peligro", async () => {
    const impact = impactOf({
      ledger: ledger({
        vault: { balanceEfectivoVes: 800, balanceRef: 10, balanceVes: 300, id: "vault-1" },
        vaultMovements: [
          { amountRef: 0, amountVes: 1000, id: "vm-1", type: "sale_in", vaultId: "vault-1" },
        ],
      }),
      payment: { ...salePayment, method: "pago_movil" },
    });
    const note = impact.effects[0].note ?? "";

    impactResponse = async () => jsonResponse({ data: impact });
    renderModal();

    await screen.findByRole("button", { name: "Anular pago" });

    expect(note).toContain("dejará de cuadrar con sus movimientos");
    expect(effectRow(note)).toHaveAttribute("data-tone", "danger");
    // Saldo real que dejará la RPC: 300 → 0, no −700.
    expect(effectRow("Sale del baúl (cuenta): −Bs. 300,00")).toHaveTextContent(
      /Bs\. 300,00.*pasa a.*Bs\. 0,00/,
    );
  });

  it("caja ya cerrada sin transferir: la aclaración del asiento se ve como aviso", async () => {
    const impact = impactOf({
      ledger: ledger({ cashMovements: [{ ...openCashSaleIn, sessionStatus: "closed" }] }),
    });

    impactResponse = async () => jsonResponse({ data: impact });
    renderModal();

    await screen.findByRole("button", { name: "Anular pago" });

    expect(effectRow(impact.effects[0].note ?? "")).toHaveAttribute("data-tone", "warning");
  });

  it("AUD-01 · sin permiso de baúl ni de caja: dice cuánto se mueve, sin saldos ni nombre de caja", async () => {
    const impact = impactOf({
      ledger: ledger({
        cashMovements: [{ ...openCashSaleIn, type: "account_in" }],
        hidden: { cash: true, vault: true },
        vault: null,
        vaultMovements: [{ amountRef: 0, amountVes: 1000, id: "vm-1", type: "sale_in", vaultId: "vault-1" }],
      }),
      payment: { ...salePayment, method: "pago_movil" },
    });

    impactResponse = async () => jsonResponse({ data: impact });
    renderModal();

    await screen.findByRole("button", { name: "Anular pago" });

    const vault = effectRow(/Sale del baúl \(cuenta\)/);

    expect(vault).toHaveTextContent("−Bs. 1.000,00");
    expect(vault).not.toHaveTextContent("pasa a");
    expect(screen.getByText(/Se quita del turno de la caja el cobro por cuenta/)).toBeInTheDocument();
    expect(screen.queryByText(/sin nombre/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No se pudo leer el saldo del baúl/)).not.toBeInTheDocument();
  });

  it("modo demo (inexact, sin asientos): dice por qué no hay cifra y no inventa ninguna", async () => {
    const reason =
      "El modo demo no registra asientos de caja ni de baúl por pago: no se puede anticipar de dónde sale ni a dónde vuelve el dinero.";

    impactResponse = async () =>
      jsonResponse({ data: impactOf({ ledger: { kind: "unavailable", reason } }) });
    renderModal();

    await screen.findByRole("button", { name: "Anular pago" });
    const dialog = screen.getByRole("dialog");

    expect(effectRow(reason)).toHaveAttribute("data-tone", "warning");
    expect(dialog).not.toHaveTextContent(/Sale de|Vuelve a/);
    // Lo que sí se conoce con exactitud se sigue mostrando.
    expect(effectRow("Estado de la venta")).toHaveTextContent(/Pagada.*pasa a.*Pendiente de pago/);
  });

  it.each([
    ["ya anulado", { payment: { ...salePayment, status: "anulado" as const } }, "El pago ya fue anulado"],
    [
      "cierre transferido al baúl",
      {
        ledger: ledger({
          cashMovements: [
            {
              ...openCashSaleIn,
              sessionStatus: "closed" as const,
              vaultTransferredAt: "2026-10-01T12:00:00.000Z",
            },
          ],
        }),
      },
      "No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo",
    ],
    ["sin permiso", { canCancelPayments: false }, "No autorizado para anular pagos"],
  ])("bloqueado (%s): muestra el motivo tal cual y no hay botón de anular", async (_, overrides, reason) => {
    impactResponse = async () => jsonResponse({ data: impactOf(overrides) });
    renderModal();

    const dialog = within(await screen.findByRole("dialog", { name: "No se puede anular el pago" }));

    expect(dialog.getByRole("alert")).toHaveTextContent(reason);
    expect(dialog.getByRole("alert").textContent).toBe(reason);
    expect(dialog.queryByRole("button", { name: "Anular pago" })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    // Sin proyección: no hay lista de efectos.
    expect(dialog.queryByText("Qué va a pasar")).not.toBeInTheDocument();
  });

  it("si el impact falla muestra el error, no deja confirmar y permite reintentar", async () => {
    const user = userEvent.setup();

    impactResponse = async () =>
      jsonResponse({ error: { code: "NOT_FOUND", message: "Pago no encontrado." } }, 404);
    renderModal();

    const dialog = within(await screen.findByRole("dialog"));

    expect(await dialog.findByRole("alert")).toHaveTextContent("Pago no encontrado.");
    expect(dialog.queryByRole("button", { name: "Anular pago" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    impactResponse = async () => jsonResponse({ data: impactOf() });
    await user.click(dialog.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("button", { name: "Anular pago" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancelar no llama a la anulación", async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = renderModal();

    await screen.findByRole("button", { name: "Anular pago" });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("doble clic en «Anular pago» confirma una sola vez", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal();

    await user.dblClick(await screen.findByRole("button", { name: "Anular pago" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("SHR-19 M4: muestra dentro del modal el error que llega después de abrirlo, tal cual", async () => {
    const { rerender } = renderModal();

    await screen.findByRole("button", { name: "Anular pago" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender({ error: "El pago pertenece a una caja ya cerrada." });

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "El pago pertenece a una caja ya cerrada.",
    );
    expect(screen.getByRole("button", { name: "Anular pago" })).toBeEnabled();
    // El rechazo no vuelve a pedir el impact ni cambia las cifras que se leían.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("al reabrir recalcula el efecto y devuelve el foco a quien abrió el modal", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();

    function Host() {
      const [open, setOpen] = useState(false);

      return (
        <QueryClientProvider client={queryClient}>
          <button onClick={() => setOpen(true)} type="button">
            Abrir
          </button>
          <PaymentCancelConfirmModal
            onConfirm={jest.fn()}
            onOpenChange={setOpen}
            open={open}
            paymentId="pay-001"
          />
        </QueryClientProvider>
      );
    }

    render(<Host />);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await screen.findByRole("button", { name: "Anular pago" });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Abrir" })).toHaveFocus());

    // Entre una apertura y otra el pago se anuló: la segunda no enseña el efecto viejo.
    let resolveImpact: (response: Response) => void = () => undefined;

    impactResponse = () =>
      new Promise<Response>((resolve) => {
        resolveImpact = resolve;
      });
    await user.click(screen.getByRole("button", { name: "Abrir" }));

    const dialog = within(await screen.findByRole("dialog"));

    expect(dialog.queryByRole("button", { name: "Anular pago" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveImpact(
      jsonResponse({ data: impactOf({ payment: { ...salePayment, status: "anulado" } }) }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("El pago ya fue anulado");
    expect(screen.queryByRole("button", { name: "Anular pago" })).not.toBeInTheDocument();

    // CNF-S1: también bloqueado (abrió cargando) el foco vuelve a quien lo abrió.
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Abrir" })).toHaveFocus());
  });
});
