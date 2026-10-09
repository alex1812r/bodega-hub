/** COM-07 · el estado «Pedido» se distingue de «Recibido» por texto, icono y tono. */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { PurchasesStatusBadge } from "./PurchasesStatusBadge";

describe("PurchasesStatusBadge (COM-07)", () => {
  it("pedido: dice que no se ha recibido y lleva icono", () => {
    render(<PurchasesStatusBadge status="pedido" />);

    const badge = screen.getByText("Pedido · sin recibir");

    expect(badge).toHaveAttribute("data-status", "pedido");
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(badge).toHaveClass("border-dashed");
  });

  it("recibido: texto propio, sin el icono ni el borde del pedido", () => {
    render(<PurchasesStatusBadge status="recibido" />);

    const badge = screen.getByText("Recibido");

    expect(badge.querySelector("svg")).toBeNull();
    expect(badge).not.toHaveClass("border-dashed");
    expect(screen.queryByText(/sin recibir/)).not.toBeInTheDocument();
  });

  it("pedido y recibido no comparten clases de tono", () => {
    const { container } = render(
      <>
        <PurchasesStatusBadge status="pedido" />
        <PurchasesStatusBadge status="recibido" />
      </>,
    );
    const [pedido, recibido] = Array.from(container.querySelectorAll("[data-status]"));
    const tone = (element: Element) =>
      Array.from(element.classList).filter((name) => /(^|:)(bg|text|border)-/.test(name));
    const recibidoTone = new Set(tone(recibido));

    expect(tone(pedido).filter((name) => recibidoTone.has(name))).toEqual(["text-xs"]);
  });

  it.each([
    ["cancelado", "Cancelado"],
    ["devuelto", "Devuelto"],
  ] as const)("%s conserva su etiqueta", (status, label) => {
    render(<PurchasesStatusBadge status={status} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
