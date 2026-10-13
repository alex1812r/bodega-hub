/**
 * CNF-F2 · «Mercancía que entra» hace scroll por dentro (`max-h-64`) y, salvo
 * en los empaques con receta, sus líneas no tienen nada enfocable: con teclado
 * no se podía leer entera. Cuando desborda es una parada de Tab con nombre y
 * anillo de foco, igual que la zona «Qué va a pasar»; si cabe, no añade nada.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { installScrollLayout } from "@/shared/components/ConfirmActionModal/scrollLayout.testUtils";

import { allowedPurchaseImpact } from "../../components/purchaseImpact.testFixtures";
import type { ReceivePreviewLine } from "../utils/buildReceivePreview";
import { PurchaseReceivePreviewModal } from "./PurchaseReceivePreviewModal";

const GROUP = "Mercancía que entra";

const LINES: ReceivePreviewLine[] = Array.from({ length: 14 }, (_, index) => ({
  name: `Producto ${index + 1}`,
  productId: `prod-${index + 1}`,
  productInactive: false,
  purchaseItemId: `item-${index + 1}`,
  quantityIn: 5,
  stockAfter: 15,
  stockBefore: 10,
  unitCostRef: 2,
}));

function renderModal(lines: ReceivePreviewLine[]) {
  render(
    <PurchaseReceivePreviewModal
      effect={{ impact: allowedPurchaseImpact("receive"), status: "ready" }}
      lines={lines}
      onConfirm={jest.fn()}
      onOpenChange={jest.fn()}
      open
      purchaseNumber="C-20261008-000003"
    />,
  );

  return within(screen.getByRole("dialog", { name: "Recibir mercancía" }));
}

describe("PurchaseReceivePreviewModal · «Mercancía que entra» con scroll y teclado (CNF-F2)", () => {
  let scroll: ReturnType<typeof installScrollLayout>;

  beforeEach(() => {
    // Solo la lista con alto máximo propio (`max-h-64`, 256 px) mide algo.
    scroll = installScrollLayout((element) => element.classList.contains("max-h-64"), 256);
  });

  afterEach(() => {
    scroll.restore();
  });

  it("si desborda, la lista es un grupo con nombre al que llega Tab", async () => {
    const user = userEvent.setup();
    const dialog = renderModal(LINES);
    scroll.layout(980);

    const group = dialog.getByRole("group", { name: GROUP });

    expect(group).toHaveClass("overflow-y-auto");
    expect(group).toHaveAttribute("tabindex", "0");
    expect(group.className).toMatch(/focus-visible:ring-ring/);
    // La lista sigue siendo una lista con su nombre, dentro de la zona enfocable.
    expect(within(within(group).getByRole("list", { name: GROUP })).getAllByRole("listitem")).toHaveLength(
      14,
    );

    const stops: Array<Element | null> = [];
    for (let index = 0; index < 5; index += 1) {
      await user.tab();
      stops.push(document.activeElement);
    }

    expect(stops).toContain(group);
  });

  it("si cabe, no añade una parada de Tab ni un grupo", () => {
    const dialog = renderModal(LINES.slice(0, 2));
    scroll.layout(140);

    expect(dialog.queryByRole("group", { name: GROUP })).not.toBeInTheDocument();
    expect(dialog.getByRole("list", { name: GROUP }).parentElement).not.toHaveAttribute("tabindex");
  });
});
