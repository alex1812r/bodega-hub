/**
 * CNF-05 · «Cancelar compra» confirma con el efecto real de `cancel_purchase`:
 * si estaba recibida saca su mercancía, no mueve dinero ni revierte costos y,
 * con un pago activo o sin stock suficiente, la RPC rechaza (el modal no ofrece
 * cancelar).
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import { createQueryWrapper, jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import type { PurchaseImpact } from "../services/purchaseImpact";
import {
  allowedPurchaseImpact,
  IMPACT_PURCHASE_ID,
  PURCHASE_PAYMENTS_BLOCKED_REASON,
  PURCHASE_STOCK_BLOCKED_REASON,
  purchaseImpactPaymentLine,
  purchaseImpactStockLine,
  rejectedPurchaseImpact,
} from "./purchaseImpact.testFixtures";
import { PurchaseCancelConfirmModal } from "./PurchaseCancelConfirmModal";

type ModalProps = ComponentProps<typeof PurchaseCancelConfirmModal>;

const PAYMENTS_HREF = `/payments?purchaseId=${IMPACT_PURCHASE_ID}&returnTo=%2Fpurchases`;
const TITLE = "Cancelar compra";
const BLOCKED_TITLE = "No se puede cancelar la compra";
const fetchMock = jest.fn();

function respondWith(impact: PurchaseImpact) {
  fetchMock.mockResolvedValue(jsonResponse({ data: impact }));
}

function renderModal(overrides: Partial<ModalProps> = {}) {
  const handlers = { onConfirm: jest.fn(), onOpenChange: jest.fn() };
  const view = render(
    <PurchaseCancelConfirmModal
      open
      paymentsHref={PAYMENTS_HREF}
      purchaseId={IMPACT_PURCHASE_ID}
      {...handlers}
      {...overrides}
    />,
    { wrapper: createQueryWrapper() },
  );

  return { ...handlers, ...view };
}

/** El modal ya con el efecto calculado. */
async function effectDialog() {
  await screen.findByText("Qué va a pasar");

  return within(screen.getByRole("dialog", { name: TITLE }));
}

describe("PurchaseCancelConfirmModal", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("cerrado no pide el efecto ni pinta nada", () => {
    renderModal({ open: false });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("compra recibida: n.º, proveedor, estado antes → después y, por producto, lo que sale y el stock antes → después", async () => {
    respondWith(
      allowedPurchaseImpact("cancel", {
        stock: [
          purchaseImpactStockLine(),
          purchaseImpactStockLine({
            isActive: false,
            productId: "prod-malta",
            productName: "Malta Maltín",
            quantityDelta: -36,
            sku: null,
            stockAfter: 4,
            stockBefore: 40,
          }),
        ],
      }),
    );
    renderModal();

    const dialog = await effectDialog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/purchases/${IMPACT_PURCHASE_ID}/impact?action=cancel`,
    );
    expect(dialog.getByText("#C-20261009-000007")).toBeInTheDocument();
    expect(dialog.getByText("Distribuidora Polar")).toBeInTheDocument();
    expect(dialog.getByText("Recibido")).toBeInTheDocument();
    expect(dialog.getByText("Cancelado")).toBeInTheDocument();

    const [harina, malta] = within(
      dialog.getByRole("list", { name: "Productos que salen del inventario" }),
    ).getAllByRole("listitem");

    expect(harina).toHaveTextContent("Harina PAN 1 kg");
    expect(harina).toHaveTextContent("−5 un");
    expect(harina).toHaveTextContent("15 un");
    expect(harina).toHaveTextContent("10 un");
    expect(harina).not.toHaveTextContent("inactivo");
    expect(malta).toHaveTextContent("−36 un");
    expect(malta).toHaveTextContent("Producto inactivo: su stock sale igual.");
    expect(dialog.getByText("Sin pagos registrados: esta acción no mueve dinero.")).toBeInTheDocument();
    expect(
      dialog.getByText(
        "El costo de los productos no se revierte: queda el que fijó la recepción de esta compra.",
      ),
    ).toBeInTheDocument();
  });

  it("pedido sin recibir: dice que el inventario no cambia y no habla de costos", async () => {
    respondWith(allowedPurchaseImpact("cancel", { status: "pedido" }));
    renderModal();

    const dialog = await effectDialog();

    expect(
      dialog.getByText(
        "El inventario no cambia: la mercancía de este pedido no se había recibido.",
      ),
    ).toBeInTheDocument();
    expect(dialog.getByText("Pedido · sin recibir")).toBeInTheDocument();
    expect(dialog.getByText("Cancelado")).toBeInTheDocument();
    expect(dialog.queryByText(/El costo de los productos no se revierte/)).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: TITLE })).toBeEnabled();
  });

  it("un pago ya anulado se lista y no impide cancelar", async () => {
    respondWith(
      allowedPurchaseImpact("cancel", {
        payments: [
          purchaseImpactPaymentLine({
            description: "Ya estaba anulado: nada que revertir.",
            outcome: "already_cancelled",
            status: "anulado",
            statusAfter: "anulado",
          }),
        ],
      }),
    );
    renderModal();

    const dialog = await effectDialog();
    const payment = within(dialog.getByRole("list", { name: "Pagos de la compra" })).getByRole(
      "listitem",
    );

    expect(payment).toHaveTextContent("Ya anulado");
    expect(payment).toHaveTextContent("Ya estaba anulado: nada que revertir.");
    expect(dialog.getByRole("button", { name: TITLE })).toBeEnabled();
  });

  it("rol que no ve pagos y acción permitida: lo dice sin cifras", async () => {
    respondWith(allowedPurchaseImpact("cancel", { paymentsRestricted: true }));
    renderModal();

    const dialog = await effectDialog();

    expect(
      dialog.getByText("Tu usuario no ve los pagos de las compras. Esta acción no mueve dinero."),
    ).toBeInTheDocument();
    expect(dialog.queryByRole("list", { name: "Pagos de la compra" })).not.toBeInTheDocument();
  });

  it("cancelar cierra sin ejecutar", async () => {
    respondWith(allowedPurchaseImpact("cancel"));
    const { onConfirm, onOpenChange } = renderModal();
    const dialog = await effectDialog();

    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("doble clic en «Cancelar compra» ejecuta una sola vez", async () => {
    respondWith(allowedPurchaseImpact("cancel"));
    const onConfirm = jest.fn(() => new Promise<void>(() => undefined));

    renderModal({ onConfirm });

    const dialog = await effectDialog();
    const confirm = dialog.getByRole("button", { name: TITLE });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("es una acción de peligro: el foco inicial no cae en confirmar", async () => {
    respondWith(allowedPurchaseImpact("cancel"));
    renderModal();

    const dialog = await effectDialog();

    await waitFor(() => expect(dialog.getByRole("button", { name: "Cancelar" })).toHaveFocus());
  });

  it("el rechazo de la RPC al ejecutar se muestra tal cual y el modal sigue abierto", async () => {
    respondWith(allowedPurchaseImpact("cancel"));
    const view = renderModal();

    await effectDialog();
    view.rerender(
      <PurchaseCancelConfirmModal
        error={PURCHASE_STOCK_BLOCKED_REASON}
        onConfirm={view.onConfirm}
        onOpenChange={view.onOpenChange}
        open
        purchaseId={IMPACT_PURCHASE_ID}
      />,
    );

    const dialog = within(screen.getByRole("dialog", { name: TITLE }));

    expect(dialog.getByRole("alert")).toHaveTextContent(PURCHASE_STOCK_BLOCKED_REASON);
    expect(view.onOpenChange).not.toHaveBeenCalled();
  });

  it("mientras calcula el efecto no hay botón de cancelar la compra", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const { onConfirm } = renderModal();
    const dialog = within(await screen.findByRole("dialog", { name: TITLE }));

    expect(dialog.getByRole("status")).toHaveTextContent("Calculando qué va a pasar");
    expect(dialog.queryByRole("button", { name: TITLE })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("si el efecto no se puede calcular: error, «Reintentar» y nada que confirmar a ciegas", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "NOT_FOUND", message: "Compra no encontrada" } }, 404),
    );
    const { onConfirm } = renderModal();
    const dialog = within(await screen.findByRole("dialog", { name: TITLE }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("Compra no encontrada");
    expect(dialog.queryByRole("button", { name: TITLE })).not.toBeInTheDocument();

    respondWith(allowedPurchaseImpact("cancel"));
    fireEvent.click(dialog.getByRole("button", { name: "Reintentar" }));

    expect(await dialog.findByRole("button", { name: TITLE })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("con un pago activo: bloqueada, motivo tal cual, el pago que hay que anular y enlace a los pagos; sin botón de cancelar", async () => {
    respondWith(
      rejectedPurchaseImpact("cancel", PURCHASE_PAYMENTS_BLOCKED_REASON, {
        payments: [purchaseImpactPaymentLine()],
      }),
    );
    const { onConfirm } = renderModal();
    const dialog = within(await screen.findByRole("dialog", { name: BLOCKED_TITLE }));

    expect(dialog.getByRole("alert")).toHaveTextContent(PURCHASE_PAYMENTS_BLOCKED_REASON);
    // Nada se proyecta: el estado no cambia.
    expect(dialog.getByText("Recibido")).toBeInTheDocument();
    expect(dialog.queryByText("Cancelado")).not.toBeInTheDocument();

    const payment = within(dialog.getByRole("list", { name: "Pagos que lo impiden" })).getByRole(
      "listitem",
    );

    expect(payment).toHaveTextContent("Transferencia");
    expect(payment).toHaveTextContent("Hay que anularlo antes");
    expect(dialog.getByRole("link", { name: "Ver pagos de la compra" })).toHaveAttribute(
      "href",
      PAYMENTS_HREF,
    );
    expect(dialog.queryByRole("button", { name: TITLE })).not.toBeInTheDocument();
    expect(dialog.queryByText("Qué va a pasar")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("bloqueada y el rol no ve pagos: motivo tal cual, aviso sin cifras propias y sin enlace a pagos", async () => {
    respondWith(
      rejectedPurchaseImpact("cancel", PURCHASE_PAYMENTS_BLOCKED_REASON, {
        paymentsRestricted: true,
      }),
    );
    renderModal({ paymentsHref: undefined });

    const dialog = within(await screen.findByRole("dialog", { name: BLOCKED_TITLE }));

    expect(dialog.getByRole("alert")).toHaveTextContent(PURCHASE_PAYMENTS_BLOCKED_REASON);
    expect(dialog.getByRole("note")).toHaveTextContent(
      "Tu usuario no ve los pagos de las compras. Si el motivo son pagos activos, pide a un administrador o contador que los anule antes.",
    );
    expect(dialog.queryByRole("list", { name: "Pagos que lo impiden" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("link")).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: TITLE })).not.toBeInTheDocument();
  });

  it("sin stock suficiente: bloqueada con el producto, lo que hay, lo que tiene que salir y cuánto falta", async () => {
    respondWith(
      rejectedPurchaseImpact("cancel", PURCHASE_STOCK_BLOCKED_REASON, {
        blockingProducts: [
          {
            available: 2,
            productId: "prod-harina",
            productName: "Harina PAN 1 kg",
            required: 5,
            sku: "HAR-1",
          },
        ],
      }),
    );
    renderModal();

    const dialog = within(await screen.findByRole("dialog", { name: BLOCKED_TITLE }));
    const product = within(
      dialog.getByRole("list", { name: "Productos sin stock suficiente" }),
    ).getByRole("listitem");

    expect(dialog.getByRole("alert")).toHaveTextContent(PURCHASE_STOCK_BLOCKED_REASON);
    expect(product).toHaveTextContent("Harina PAN 1 kg");
    expect(product).toHaveTextContent("Hay 2 un y tienen que salir 5 un: faltan 3 un.");
    expect(dialog.queryByRole("button", { name: TITLE })).not.toBeInTheDocument();
    // No es un bloqueo por pagos: no ofrece el enlace.
    expect(dialog.queryByRole("link")).not.toBeInTheDocument();
  });
});
