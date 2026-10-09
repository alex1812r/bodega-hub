/**
 * CNF-F2 · las listas con scroll propio de una compra bloqueada (pagos que hay
 * que anular antes, productos sin stock suficiente) no se alcanzaban con
 * teclado: en ese estado el diálogo no tiene nada enfocable dentro de ellas.
 * Cuando desbordan son una parada de Tab con nombre y anillo de foco, igual que
 * la zona «Qué va a pasar»; si caben, no añaden nada al orden de foco.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createQueryWrapper, jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";
import { installScrollLayout } from "@/shared/components/ConfirmActionModal/scrollLayout.testUtils";

import type { PurchaseImpact } from "../services/purchaseImpact";
import {
  IMPACT_PURCHASE_ID,
  PURCHASE_PAYMENTS_BLOCKED_REASON,
  PURCHASE_STOCK_BLOCKED_REASON,
  purchaseImpactPaymentLine,
  rejectedPurchaseImpact,
} from "./purchaseImpact.testFixtures";
import { PurchaseCancelConfirmModal } from "./PurchaseCancelConfirmModal";

const BLOCKED_TITLE = "No se puede cancelar la compra";
const PAYMENTS_GROUP = "Pagos que hay que anular antes";
const PRODUCTS_GROUP = "Productos que lo impiden";
const fetchMock = jest.fn();

const manyPayments = Array.from({ length: 12 }, (_, index) =>
  purchaseImpactPaymentLine({ paymentId: `pay-${index + 1}` }),
);
const manyProducts = Array.from({ length: 12 }, (_, index) => ({
  available: 1,
  productId: `prod-${index + 1}`,
  productName: `Producto ${index + 1}`,
  required: 4,
  sku: `SKU-${index + 1}`,
}));

async function renderBlocked(impact: PurchaseImpact) {
  fetchMock.mockResolvedValue(jsonResponse({ data: impact }));
  render(
    <PurchaseCancelConfirmModal
      onConfirm={jest.fn()}
      onOpenChange={jest.fn()}
      open
      purchaseId={IMPACT_PURCHASE_ID}
    />,
    { wrapper: createQueryWrapper() },
  );

  return within(await screen.findByRole("dialog", { name: BLOCKED_TITLE }));
}

async function tabStops(count: number) {
  const user = userEvent.setup();
  const stops: Array<Element | null> = [];

  for (let index = 0; index < count; index += 1) {
    await user.tab();
    stops.push(document.activeElement);
  }

  return stops;
}

describe("Compra bloqueada · listas con scroll y teclado (CNF-F2)", () => {
  let scroll: ReturnType<typeof installScrollLayout>;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    // Solo las listas con alto máximo propio (`max-h-56`, 224 px) miden algo.
    scroll = installScrollLayout((element) => element.classList.contains("max-h-56"));
  });

  afterEach(() => {
    scroll.restore();
  });

  it("pagos que hay que anular antes: si desbordan, la lista es un grupo con nombre al que llega Tab", async () => {
    const dialog = await renderBlocked(
      rejectedPurchaseImpact("cancel", PURCHASE_PAYMENTS_BLOCKED_REASON, { payments: manyPayments }),
    );
    scroll.layout(900);

    const group = dialog.getByRole("group", { name: PAYMENTS_GROUP });

    expect(group).toHaveClass("overflow-y-auto");
    expect(group).toHaveAttribute("tabindex", "0");
    expect(group.className).toMatch(/focus-visible:ring-ring/);
    // La lista sigue siendo una lista con su nombre, dentro de la zona enfocable.
    expect(
      within(within(group).getByRole("list", { name: "Pagos que lo impiden" })).getAllByRole("listitem"),
    ).toHaveLength(12);
    expect(await tabStops(4)).toContain(group);
  });

  it("productos sin stock suficiente: si desbordan, la lista es un grupo con nombre al que llega Tab", async () => {
    const dialog = await renderBlocked(
      rejectedPurchaseImpact("cancel", PURCHASE_STOCK_BLOCKED_REASON, {
        blockingProducts: manyProducts,
      }),
    );
    scroll.layout(900);

    const group = dialog.getByRole("group", { name: PRODUCTS_GROUP });

    expect(group).toHaveClass("overflow-y-auto");
    expect(group).toHaveAttribute("tabindex", "0");
    expect(group.className).toMatch(/focus-visible:ring-ring/);
    expect(
      within(
        within(group).getByRole("list", { name: "Productos sin stock suficiente" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(12);
    expect(await tabStops(4)).toContain(group);
  });

  it("si la lista cabe, no añade una parada de Tab ni un grupo", async () => {
    const dialog = await renderBlocked(
      rejectedPurchaseImpact("cancel", PURCHASE_PAYMENTS_BLOCKED_REASON, {
        blockingProducts: manyProducts.slice(0, 1),
        payments: manyPayments.slice(0, 1),
      }),
    );
    scroll.layout(120);

    expect(dialog.queryByRole("group")).not.toBeInTheDocument();
    expect(dialog.getByRole("list", { name: "Pagos que lo impiden" }).parentElement).not.toHaveAttribute(
      "tabindex",
    );
    expect(
      dialog.getByRole("list", { name: "Productos sin stock suficiente" }).parentElement,
    ).not.toHaveAttribute("tabindex");

    for (const stop of await tabStops(4)) {
      expect(stop?.tagName).toBe("BUTTON");
    }
  });

  it("deja de ser una parada de Tab cuando el contenido vuelve a caber", async () => {
    const dialog = await renderBlocked(
      rejectedPurchaseImpact("cancel", PURCHASE_STOCK_BLOCKED_REASON, {
        blockingProducts: manyProducts,
      }),
    );
    scroll.layout(900);
    expect(dialog.getByRole("group", { name: PRODUCTS_GROUP })).toHaveAttribute("tabindex", "0");

    scroll.layout(200);

    expect(dialog.queryByRole("group", { name: PRODUCTS_GROUP })).not.toBeInTheDocument();
  });
});
