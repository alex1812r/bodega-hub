/**
 * CNF-05 · «Devolver compra» confirma con el efecto real de `return_purchase`:
 * la mercancía recibida sale del inventario, no se mueve dinero ni se revierte
 * el costo y, con un pago activo o sin stock suficiente, la RPC rechaza.
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
import { PurchaseReturnConfirmModal } from "./PurchaseReturnConfirmModal";

type ModalProps = ComponentProps<typeof PurchaseReturnConfirmModal>;

const PAYMENTS_HREF = `/payments?purchaseId=${IMPACT_PURCHASE_ID}&returnTo=%2Fpurchases`;
const TITLE = "Devolver compra";
const BLOCKED_TITLE = "No se puede devolver la compra";
const fetchMock = jest.fn();

function respondWith(impact: PurchaseImpact) {
  fetchMock.mockResolvedValue(jsonResponse({ data: impact }));
}

function renderModal(overrides: Partial<ModalProps> = {}) {
  const handlers = { onConfirm: jest.fn(), onOpenChange: jest.fn() };
  const view = render(
    <PurchaseReturnConfirmModal
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

async function effectDialog() {
  await screen.findByText("Qué va a pasar");

  return within(screen.getByRole("dialog", { name: TITLE }));
}

describe("PurchaseReturnConfirmModal", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("pide el efecto de devolver y muestra estado antes → después, lo que sale por producto y que el costo no se revierte", async () => {
    respondWith(
      allowedPurchaseImpact("return", {
        stock: [
          purchaseImpactStockLine(),
          // Ya se había devuelto entera con un ajuste: no queda nada por sacar.
          purchaseImpactStockLine({
            productId: "prod-malta",
            productName: "Malta Maltín",
            quantityDelta: 0,
            sku: null,
            stockAfter: 4,
            stockBefore: 4,
          }),
        ],
      }),
    );
    renderModal();

    const dialog = await effectDialog();

    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/purchases/${IMPACT_PURCHASE_ID}/impact?action=return`,
    );
    expect(dialog.getByText("Recibido")).toBeInTheDocument();
    expect(dialog.getByText("Devuelto")).toBeInTheDocument();

    const [harina, malta] = within(
      dialog.getByRole("list", { name: "Productos que salen del inventario" }),
    ).getAllByRole("listitem");

    expect(harina).toHaveTextContent("−5 un");
    expect(harina).toHaveTextContent("15 un");
    expect(harina).toHaveTextContent("10 un");
    expect(malta).toHaveTextContent("4 un (no cambia: no quedan unidades por sacar)");
    expect(dialog.getByText(/El costo de los productos no se revierte/)).toBeInTheDocument();
    expect(dialog.getByText("Sin pagos registrados: esta acción no mueve dinero.")).toBeInTheDocument();
  });

  it("cancelar cierra sin ejecutar", async () => {
    respondWith(allowedPurchaseImpact("return"));
    const { onConfirm, onOpenChange } = renderModal();
    const dialog = await effectDialog();

    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("doble clic en «Devolver compra» ejecuta una sola vez y es una acción de peligro", async () => {
    respondWith(allowedPurchaseImpact("return"));
    const onConfirm = jest.fn(() => new Promise<void>(() => undefined));

    renderModal({ onConfirm });

    const dialog = await effectDialog();

    await waitFor(() => expect(dialog.getByRole("button", { name: "Cancelar" })).toHaveFocus());

    const confirm = dialog.getByRole("button", { name: TITLE });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("el rechazo de la RPC al ejecutar se muestra tal cual dentro del modal", async () => {
    respondWith(allowedPurchaseImpact("return"));
    const view = renderModal();

    await effectDialog();
    view.rerender(
      <PurchaseReturnConfirmModal
        error={PURCHASE_STOCK_BLOCKED_REASON}
        onConfirm={view.onConfirm}
        onOpenChange={view.onOpenChange}
        open
        purchaseId={IMPACT_PURCHASE_ID}
      />,
    );

    expect(
      within(screen.getByRole("dialog", { name: TITLE })).getByRole("alert"),
    ).toHaveTextContent(PURCHASE_STOCK_BLOCKED_REASON);
    expect(view.onOpenChange).not.toHaveBeenCalled();
  });

  it("con pagos activos: bloqueada con cada pago que hay que anular y el enlace a los pagos", async () => {
    respondWith(
      rejectedPurchaseImpact("return", PURCHASE_PAYMENTS_BLOCKED_REASON, {
        payments: [
          purchaseImpactPaymentLine(),
          purchaseImpactPaymentLine({
            amount: 4,
            amountRef: 4,
            amountVes: 2000,
            currency: "USD",
            method: "efectivo_usd",
            paymentId: "pay-2",
          }),
        ],
      }),
    );
    const { onConfirm } = renderModal();
    const dialog = within(await screen.findByRole("dialog", { name: BLOCKED_TITLE }));

    expect(dialog.getByRole("alert")).toHaveTextContent(PURCHASE_PAYMENTS_BLOCKED_REASON);
    expect(
      within(dialog.getByRole("list", { name: "Pagos que lo impiden" })).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(dialog.getByRole("link", { name: "Ver pagos de la compra" })).toHaveAttribute(
      "href",
      PAYMENTS_HREF,
    );
    expect(dialog.queryByRole("button", { name: TITLE })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("sin stock suficiente: bloqueada nombrando cada producto y cuánto falta", async () => {
    respondWith(
      rejectedPurchaseImpact("return", PURCHASE_STOCK_BLOCKED_REASON, {
        blockingProducts: [
          { available: 4, productId: "prod-harina", productName: "Harina PAN 1 kg", required: 5, sku: "HAR-1" },
          { available: 0, productId: "prod-malta", productName: "Malta Maltín", required: 36, sku: null },
        ],
      }),
    );
    renderModal();

    const dialog = within(await screen.findByRole("dialog", { name: BLOCKED_TITLE }));
    const [harina, malta] = within(
      dialog.getByRole("list", { name: "Productos sin stock suficiente" }),
    ).getAllByRole("listitem");

    expect(harina).toHaveTextContent("Hay 4 un y tienen que salir 5 un: falta 1 un.");
    expect(malta).toHaveTextContent("Hay 0 un y tienen que salir 36 un: faltan 36 un.");
    expect(dialog.queryByRole("button", { name: TITLE })).not.toBeInTheDocument();
  });
});
