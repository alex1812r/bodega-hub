import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InvoiceImageViewer } from "./InvoiceImageViewer";

// jsdom no trae `PointerEvent`: sin él los eventos de puntero llegan sin coordenadas.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

describe("InvoiceImageViewer", () => {
  it("acerca y aleja con los botones y vuelve al 100 %", async () => {
    const user = userEvent.setup();
    render(<InvoiceImageViewer alt="Factura" urls={["https://s/1.jpg"]} />);

    const image = screen.getByRole("img", { name: "Factura" });
    expect(screen.getByText("100 %")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alejar" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Acercar" }));
    await user.click(screen.getByRole("button", { name: "Acercar" }));
    expect(screen.getByText("200 %")).toBeInTheDocument();
    expect(image.style.transform).toContain("scale(2)");

    await user.click(screen.getByRole("button", { name: "Alejar" }));
    expect(screen.getByText("150 %")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restablecer zoom" }));
    expect(screen.getByText("100 %")).toBeInTheDocument();
  });

  it("la rueda acerca y, ampliada, se arrastra la imagen", () => {
    render(<InvoiceImageViewer alt="Factura" urls={["https://s/1.jpg"]} />);
    const frame = screen.getByTestId("invoice-image-frame");
    const image = screen.getByRole("img", { name: "Factura" });

    fireEvent.wheel(frame, { deltaY: -100 });
    fireEvent.wheel(frame, { deltaY: -100 });
    expect(screen.getByText("150 %")).toBeInTheDocument();

    fireEvent.pointerDown(frame, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 40, clientY: 25, pointerId: 1 });
    fireEvent.pointerUp(frame, { pointerId: 1 });
    expect(image.style.transform).toBe("scale(1.5) translate(20px, 10px)");
  });

  it("pasa de página y avisa si la imagen no carga", async () => {
    const user = userEvent.setup();
    render(<InvoiceImageViewer alt="Factura" urls={["https://s/1.jpg", "https://s/2.jpg"]} />);

    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    const second = screen.getByRole("img", { name: "Factura (página 2 de 2)" });
    expect(second).toHaveAttribute("src", "https://s/2.jpg");

    fireEvent.error(second);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar la imagen de la factura.");
  });

  it("sin páginas muestra el estado vacío", () => {
    render(<InvoiceImageViewer alt="Factura" urls={[]} />);

    expect(screen.getByRole("status")).toHaveTextContent("No hay imagen de esta factura.");
  });
});
