import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductDetailPriceChangeCard } from "./ProductDetailPriceChangeCard";

describe("ProductDetailPriceChangeCard · NumberInput (SHR-09)", () => {
  it("es un campo de texto que conserva su id y sus clases", () => {
    render(<ProductDetailPriceChangeCard currentPriceRef={2.5} onSubmit={jest.fn()} />);

    const price = screen.getByLabelText("Nuevo precio (REF)");

    expect(price).toHaveAttribute("type", "text");
    expect(price).toHaveAttribute("id", "product-new-price");
    expect(price).toHaveClass("pl-8", "rounded-lg");
    expect(price).toHaveValue("2.5");
  });

  it("al enviar con Enter un precio con 3 decimales viaja redondeado a 2", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(<ProductDetailPriceChangeCard currentPriceRef={2.5} onSubmit={onSubmit} />);

    const price = screen.getByLabelText("Nuevo precio (REF)");

    await user.clear(price);
    await user.type(price, "3,125{Enter}");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(3.13);
  });

  it("no envia si el precio no cambio", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(<ProductDetailPriceChangeCard currentPriceRef={2.5} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
