/**
 * CNF-02 · «Anular venta» confirma con el efecto real de `cancel_sale`: repone
 * stock, no toca dinero y, con un pago activo, la RPC rechaza (el modal no
 * ofrece anular).
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ComponentProps, useState } from "react";

import { createQueryWrapper, jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import type { SaleImpact } from "../services/saleImpact";
import {
  allowedSaleImpact,
  blockingPaymentLine,
  CANCEL_BLOCKED_REASON,
  IMPACT_SALE_ID,
  impactPaymentLine,
  impactStockLine,
  rejectedSaleImpact,
} from "./saleImpact.testFixtures";
import { SaleCancelConfirmModal } from "./SaleCancelConfirmModal";

type ModalProps = ComponentProps<typeof SaleCancelConfirmModal>;

const fetchMock = jest.fn();

function respondWith(impact: SaleImpact) {
  fetchMock.mockResolvedValue(jsonResponse({ data: impact }));
}

function renderModal(overrides: Partial<ModalProps> = {}) {
  const handlers = {
    onConfirm: jest.fn(),
    onOpenChange: jest.fn(),
    onUseReturn: jest.fn(),
  };

  const view = render(
    <SaleCancelConfirmModal
      open
      paymentsHref={`/payments?saleId=${IMPACT_SALE_ID}&returnTo=%2Fsales`}
      saleId={IMPACT_SALE_ID}
      {...handlers}
      {...overrides}
    />,
    { wrapper: createQueryWrapper() },
  );

  return { ...handlers, ...view };
}

/** El modal ya con el efecto calculado (antes hay otro, de carga). */
async function effectDialog() {
  await screen.findByText("Qué va a pasar");

  return within(screen.getByRole("dialog", { name: "Anular venta" }));
}

describe("SaleCancelConfirmModal", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("cerrado no pide el efecto ni pinta nada", () => {
    renderModal({ open: false });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("muestra n.º, cliente, estado y, por producto, lo que vuelve y el stock antes → después", async () => {
    respondWith(
      allowedSaleImpact("cancel", {
        stock: [
          impactStockLine(),
          impactStockLine({
            isActive: false,
            productId: "prod-cable",
            productName: "Cable HDMI 2 m",
            quantityDelta: 1,
            sku: null,
            stockAfter: 1,
            stockBefore: 0,
          }),
        ],
      }),
    );
    renderModal();

    const dialog = await effectDialog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/sales/${IMPACT_SALE_ID}/impact?action=cancel`);
    expect(dialog.getByText("#V-20261009-000007")).toBeInTheDocument();
    expect(dialog.getByText("María Pérez")).toBeInTheDocument();
    expect(dialog.getByText("Pagada")).toBeInTheDocument();
    expect(dialog.getByText("Anulada")).toBeInTheDocument();

    const [harina, cable] = within(
      dialog.getByRole("list", { name: "Productos que vuelven al stock" }),
    ).getAllByRole("listitem");

    expect(harina).toHaveTextContent("Harina PAN 1 kg");
    expect(harina).toHaveTextContent("+3 und");
    expect(harina).toHaveTextContent("7 und");
    expect(harina).toHaveTextContent("10 und");
    expect(harina).not.toHaveTextContent("inactivo");
    expect(cable).toHaveTextContent("+1 und");
    expect(cable).toHaveTextContent("Producto inactivo: su stock se repone igual.");
    expect(dialog.getByText("Sin pagos registrados: nada que revertir.")).toBeInTheDocument();
    // Anular no devuelve dinero: no hay sección de devolución.
    expect(dialog.queryByText("Dinero a devolver al cliente")).not.toBeInTheDocument();
  });

  it("un pago ya anulado se lista como «nada que revertir» y no impide anular", async () => {
    respondWith(
      allowedSaleImpact("cancel", {
        payments: [
          impactPaymentLine({
            description: "Ya estaba anulado: nada que revertir.",
            effects: [],
            method: "pago_movil",
            outcome: "already_cancelled",
            status: "anulado",
          }),
        ],
      }),
    );
    renderModal();

    const dialog = await effectDialog();
    const payment = within(dialog.getByRole("list", { name: "Pagos de la venta" })).getByRole(
      "listitem",
    );

    expect(payment).toHaveTextContent("Pago móvil");
    expect(payment).toHaveTextContent("Ya anulado");
    expect(payment).toHaveTextContent("Ya estaba anulado: nada que revertir.");
    expect(dialog.getByRole("button", { name: "Anular venta" })).toBeEnabled();
  });

  it("cancelar cierra sin ejecutar", async () => {
    respondWith(allowedSaleImpact("cancel"));
    const { onConfirm, onOpenChange } = renderModal();
    const dialog = await effectDialog();

    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("doble clic en «Anular venta» ejecuta una sola vez", async () => {
    respondWith(allowedSaleImpact("cancel"));
    const onConfirm = jest.fn(() => new Promise<void>(() => undefined));

    renderModal({ onConfirm });

    const dialog = await effectDialog();
    const confirm = dialog.getByRole("button", { name: "Anular venta" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("sin dinero cobrado no pide palabra; con dinero cobrado exige ANULAR sin distinguir mayúsculas", async () => {
    respondWith(allowedSaleImpact("cancel"));
    const first = renderModal();

    await effectDialog();
    expect(screen.queryByLabelText("Palabra de confirmación")).not.toBeInTheDocument();
    first.unmount();

    respondWith(allowedSaleImpact("cancel", { paidVes: 120, paidVesAfter: 120 }));
    const { onConfirm } = renderModal();
    const dialog = await effectDialog();
    const confirm = dialog.getByRole("button", { name: "Anular venta" });

    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(dialog.getByLabelText("Palabra de confirmación"), {
      target: { value: "anular" },
    });

    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("es una acción de peligro: el foco inicial no cae en confirmar", async () => {
    respondWith(allowedSaleImpact("cancel"));
    renderModal();

    const dialog = await effectDialog();

    await waitFor(() => expect(dialog.getByRole("button", { name: "Cancelar" })).toHaveFocus());
  });

  it("el rechazo de la RPC al ejecutar se muestra tal cual y el modal sigue abierto", async () => {
    respondWith(allowedSaleImpact("cancel"));
    const view = renderModal();

    await effectDialog();
    view.rerender(
      <SaleCancelConfirmModal
        error={CANCEL_BLOCKED_REASON}
        onConfirm={view.onConfirm}
        onOpenChange={view.onOpenChange}
        open
        saleId={IMPACT_SALE_ID}
      />,
    );

    const dialog = within(screen.getByRole("dialog", { name: "Anular venta" }));

    expect(dialog.getByRole("alert")).toHaveTextContent(CANCEL_BLOCKED_REASON);
    expect(view.onOpenChange).not.toHaveBeenCalled();
  });

  it("mientras calcula el efecto no hay botón de anular", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const { onConfirm } = renderModal();
    const dialog = within(await screen.findByRole("dialog", { name: "Anular venta" }));

    expect(dialog.getByRole("status")).toHaveTextContent("Calculando qué va a pasar");
    expect(dialog.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("es un solo diálogo de la carga al efecto y, al cerrar, el foco vuelve a quien lo abrió", async () => {
    let resolveImpact: (response: Response) => void = () => undefined;

    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveImpact = resolve;
      }),
    );

    function Host() {
      const [open, setOpen] = useState(false);

      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Abrir
          </button>
          <SaleCancelConfirmModal
            onConfirm={jest.fn()}
            onOpenChange={setOpen}
            open={open}
            saleId={IMPACT_SALE_ID}
          />
        </>
      );
    }

    render(<Host />, { wrapper: createQueryWrapper() });

    const trigger = screen.getByRole("button", { name: "Abrir" });

    trigger.focus();
    fireEvent.click(trigger);

    const loadingDialog = await screen.findByRole("dialog", { name: "Anular venta" });

    expect(within(loadingDialog).getByRole("status")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(loadingDialog).getByRole("button", { name: "Cerrar" })).toHaveFocus(),
    );

    await act(async () => {
      resolveImpact(jsonResponse({ data: allowedSaleImpact("cancel") }));
    });

    const dialog = await effectDialog();

    // El mismo nodo: no se desmontó un diálogo para montar otro.
    expect(screen.getByRole("dialog")).toBe(loadingDialog);
    await waitFor(() => expect(dialog.getByRole("button", { name: "Cancelar" })).toHaveFocus());

    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("bloqueada: el foco también vuelve a quien abrió el modal al cerrarlo", async () => {
    respondWith(
      rejectedSaleImpact("cancel", CANCEL_BLOCKED_REASON, {
        paidVes: 7650,
        payments: [blockingPaymentLine()],
      }),
    );

    function Host() {
      const [open, setOpen] = useState(false);

      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Abrir
          </button>
          <SaleCancelConfirmModal
            onConfirm={jest.fn()}
            onOpenChange={setOpen}
            open={open}
            saleId={IMPACT_SALE_ID}
          />
        </>
      );
    }

    render(<Host />, { wrapper: createQueryWrapper() });

    const trigger = screen.getByRole("button", { name: "Abrir" });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = within(
      await screen.findByRole("dialog", { name: "No se puede anular la venta" }),
    );

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(dialog.getByRole("button", { name: "Cerrar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("si el efecto falla muestra el error, no deja confirmar a ciegas y permite reintentar", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "NOT_FOUND", message: "Venta no encontrada" } }, 404),
    );
    const { onOpenChange } = renderModal();

    expect(await screen.findByRole("alert")).toHaveTextContent("Venta no encontrada");

    const failed = within(screen.getByRole("dialog", { name: "Anular venta" }));

    expect(failed.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();

    respondWith(allowedSaleImpact("cancel"));
    fireEvent.click(failed.getByRole("button", { name: "Reintentar" }));

    const dialog = await effectDialog();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dialog.getByRole("button", { name: "Anular venta" })).toBeEnabled();

    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("con un pago activo no ofrece anular: motivo exacto, pago culpable y salidas reales", async () => {
    respondWith(
      rejectedSaleImpact("cancel", CANCEL_BLOCKED_REASON, {
        paidVes: 7650,
        payments: [
          blockingPaymentLine(),
          impactPaymentLine({
            description: "Ya estaba anulado: nada que revertir.",
            effects: [],
            method: "pago_movil",
            outcome: "already_cancelled",
            paymentId: "pay-2",
            status: "anulado",
          }),
        ],
      }),
    );
    const { onConfirm, onUseReturn } = renderModal();
    const dialog = within(
      await screen.findByRole("dialog", { name: "No se puede anular la venta" }),
    );

    expect(dialog.getByRole("alert")).toHaveTextContent(CANCEL_BLOCKED_REASON);
    expect(dialog.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();
    expect(dialog.queryByLabelText("Palabra de confirmación")).not.toBeInTheDocument();

    // Solo el pago que lo impide, con método y monto.
    const blocking = within(dialog.getByRole("list", { name: "Pagos de la venta" })).getAllByRole(
      "listitem",
    );

    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toHaveTextContent("Efectivo VES");
    expect(blocking[0]).toHaveTextContent("Bs. 7.650,00");
    expect(blocking[0]).toHaveTextContent("Hay que anularlo antes");

    expect(dialog.getByRole("link", { name: "Ver pagos de la venta" })).toHaveAttribute(
      "href",
      `/payments?saleId=${IMPACT_SALE_ID}&returnTo=%2Fsales`,
    );

    fireEvent.click(dialog.getByRole("button", { name: "Devolver la venta" }));

    expect(onUseReturn).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("venta ya anulada: muestra el motivo y no ofrece ni anular ni salidas que no aplican", async () => {
    respondWith(
      rejectedSaleImpact("cancel", "La venta ya fue cancelada o devuelta", { status: "cancelada" }),
    );
    renderModal();

    const dialog = within(
      await screen.findByRole("dialog", { name: "No se puede anular la venta" }),
    );

    expect(dialog.getByRole("alert")).toHaveTextContent("La venta ya fue cancelada o devuelta");
    expect(dialog.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Devolver la venta" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("link", { name: "Ver pagos de la venta" })).not.toBeInTheDocument();
  });

  it("una parte inexacta se dice a la vista, sin cifra inventada", async () => {
    const reason = "El producto ya no existe en la tienda: no se puede leer su stock.";

    respondWith(
      allowedSaleImpact("cancel", {
        inexact: { reason },
        stock: [
          impactStockLine({
            inexact: { reason },
            isActive: null,
            productName: null,
            quantityDelta: 0,
            sku: null,
            stockAfter: null,
            stockBefore: null,
          }),
        ],
      }),
    );
    renderModal();

    const dialog = await effectDialog();
    const line = within(
      dialog.getByRole("list", { name: "Productos que vuelven al stock" }),
    ).getByRole("listitem");

    expect(dialog.getAllByText(reason)).toHaveLength(2);
    expect(line).toHaveTextContent("Producto que ya no existe");
    expect(line).not.toHaveTextContent("und");
  });
});
