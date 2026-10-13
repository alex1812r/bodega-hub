import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductDetailPriceChangeCard } from "./ProductDetailPriceChangeCard";

// GQ-09: `update_product_price` no tiene clave de idempotencia: un segundo POST es otra
// fila de historial. El modal real ya bloquea el doble clic mientras está abierto; aquí
// se sustituye por un botón que SIEMPRE llama a `onConfirm`, como en la ventana en que el
// modal se está cerrando tras el éxito y la página aún no releyó el precio.
jest.mock("../../../../shared/components/ConfirmActionModal", () => ({
  ConfirmActionModal: ({
    confirmLabel,
    onConfirm,
  }: {
    confirmLabel: string;
    onConfirm: () => void | Promise<void>;
  }) => (
    <button onClick={() => void onConfirm()} type="button">
      {confirmLabel}
    </button>
  ),
}));

describe("ProductDetailPriceChangeCard · un POST por cambio de precio (GQ-09)", () => {
  it("un clic en confirmar DESPUÉS del éxito, con el precio aún sin releer, no envía otra vez", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(<ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={12} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));
    await user.click(screen.getByRole("button", { name: "Cambiar precio" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Cambiar precio" }));
    fireEvent.click(screen.getByRole("button", { name: "Cambiar precio" }));
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("dos clics en el mismo tick mientras la petición está en vuelo: un solo envío", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn(() => new Promise<void>(() => undefined));

    render(<ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={12} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));
    fireEvent.click(screen.getByRole("button", { name: "Cambiar precio" }));
    fireEvent.click(screen.getByRole("button", { name: "Cambiar precio" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("tras el éxito, OTRO precio es otra operación: se puede confirmar y enviar", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(<ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={12} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));
    await user.click(screen.getByRole("button", { name: "Cambiar precio" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    await user.clear(screen.getByLabelText("Precio REF"));
    await user.type(screen.getByLabelText("Precio REF"), "14");
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));
    await user.click(screen.getByRole("button", { name: "Cambiar precio" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit).toHaveBeenLastCalledWith(14, expect.any(String), 10);
  });
});
