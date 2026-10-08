/**
 * PRO-07 · Resumen del detalle: semáforo de ganancia (%) junto al precio, con
 * la ganancia en REF al lado, en lugar de "Margen (REF)".
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { MARGIN_BADGE_TITLE } from "@/shared/components/MarginBadge";

import { ProductDetailInfoCard } from "./ProductDetailInfoCard";

function renderCard(costRef: number, salePriceRef: number) {
  return render(
    <ProductDetailInfoCard
      categoryName="Víveres"
      costRef={costRef}
      isActive
      salePriceRef={salePriceRef}
    />,
  );
}

function gainBlock() {
  const block = screen.getByText("Ganancia").parentElement;

  if (!block) {
    throw new Error("Sin bloque de ganancia");
  }

  return block;
}

describe("ProductDetailInfoCard · ganancia", () => {
  it("replaces 'Margen (REF)' with the margin badge and the gain in REF", () => {
    renderCard(10, 12.5);

    expect(screen.queryByText(/Margen/)).not.toBeInTheDocument();

    const badge = screen.getByTitle(MARGIN_BADGE_TITLE);

    expect(badge).toHaveTextContent("25 %");
    expect(badge).toHaveAttribute("data-band", "high");
    expect(gainBlock()).toContainElement(badge);
    expect(gainBlock()).toHaveTextContent("ref 2.50");
  });

  it("places the gain right after the sale price", () => {
    renderCard(10, 12.5);

    const price = screen.getByText("Precio venta (REF)").parentElement;

    expect(price?.nextElementSibling).toBe(gainBlock());
  });

  it.each([
    [10, 11.49, "14,9 %", "low"],
    [10, 11.5, "15 %", "mid"],
    [100, 124.99, "24,99 %", "mid"],
    [100, 125, "25 %", "high"],
  ])("cost %p and price %p show %s in the %s band", (costRef, salePriceRef, text, band) => {
    renderCard(costRef, salePriceRef);

    const badge = screen.getByTitle(MARGIN_BADGE_TITLE);

    expect(badge).toHaveTextContent(text);
    expect(badge).toHaveAttribute("data-band", band);
  });

  it("does not apply the tax again: the cost already includes it", () => {
    // Costo 1,16 = 1,00 + 16 % de IVA. Precio 1,45 → 25 % sobre 1,16 (no 45 % ni 7,8 %).
    renderCard(1.16, 1.45);

    expect(screen.getByTitle(MARGIN_BADGE_TITLE)).toHaveTextContent("25 %");
    expect(gainBlock()).toHaveTextContent("ref 0.29");
  });

  it("shows a negative percentage and a negative gain when the price is below the cost", () => {
    renderCard(10, 8);

    const badge = screen.getByTitle(MARGIN_BADGE_TITLE);

    expect(badge).toHaveTextContent("-20 %");
    expect(badge).toHaveAttribute("data-band", "low");
    expect(gainBlock()).toHaveTextContent("ref -2.00");
  });

  it("shows 'Sin costo' and no gain amount when the product has no cost", () => {
    renderCard(0, 5);

    const badge = screen.getByTitle(MARGIN_BADGE_TITLE);

    expect(badge).toHaveTextContent("Sin costo");
    expect(badge).not.toHaveAttribute("data-band");
    expect(gainBlock()).not.toHaveTextContent("ref");
    expect(gainBlock()).not.toHaveTextContent(/Infinity|NaN|∞/);
  });
});
