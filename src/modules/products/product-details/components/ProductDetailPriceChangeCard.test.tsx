import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductDetailPriceChangeCard } from "./ProductDetailPriceChangeCard";

const BADGE_TITLE = "Ganancia sobre el costo (ya con IVA)";

function priceField() {
  return screen.getByLabelText("Precio REF");
}

function pctField() {
  return screen.getByLabelText("Ganancia %");
}

function reasonField() {
  return screen.getByLabelText("Motivo");
}

describe("ProductDetailPriceChangeCard · NumberInput (SHR-09)", () => {
  it("el precio es un campo de texto que abre con el precio actual", () => {
    render(
      <ProductDetailPriceChangeCard currentCostRef={2} currentPriceRef={2.5} onSubmit={jest.fn()} />,
    );

    expect(priceField()).toHaveAttribute("type", "text");
    expect(priceField()).toHaveAttribute("inputmode", "decimal");
    expect(priceField()).toHaveValue("2.5");
  });

  it("al enviar con Enter un precio con 3 decimales viaja redondeado a 2", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(
      <ProductDetailPriceChangeCard currentCostRef={2} currentPriceRef={2.5} onSubmit={onSubmit} />,
    );

    await user.clear(priceField());
    await user.type(priceField(), "3,125{Enter}");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toBe(3.13);
  });

  it("no envia si el precio no cambio", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(
      <ProductDetailPriceChangeCard currentCostRef={2} currentPriceRef={2.5} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ProductDetailPriceChangeCard · bloque de precio (PRO-08)", () => {
  it("muestra el costo actual de solo lectura, el % vigente y ningun motivo mientras el precio no cambie", () => {
    render(
      <ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={12} onSubmit={jest.fn()} />,
    );

    expect(screen.getByText("Costo actual (ya con IVA)")).toBeInTheDocument();
    expect(screen.getByText("ref 10.00")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Costo/)).not.toBeInTheDocument();
    expect(pctField()).toHaveValue("20");
    expect(screen.getByTitle(BADGE_TITLE)).toHaveTextContent("20 %");
    expect(reasonField()).toHaveValue("");
  });

  it("un chip completa el precio nuevo, prellena el motivo y envia precio y motivo", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(
      <ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={12} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByRole("button", { name: "30 %" }));

    expect(priceField()).toHaveValue("13");
    expect(reasonField()).toHaveValue("Ajuste de margen a 30 %");

    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(13, "Ajuste de margen a 30 %");
  });

  it("escribir un % libre completa el precio y el motivo lo sigue", async () => {
    const user = userEvent.setup();

    render(
      <ProductDetailPriceChangeCard currentCostRef={8} currentPriceRef={9} onSubmit={jest.fn()} />,
    );

    await user.clear(pctField());
    await user.type(pctField(), "25");

    expect(priceField()).toHaveValue("10");
    expect(reasonField()).toHaveValue("Ajuste de margen a 25 %");
  });

  it("editar el precio recalcula el % y el motivo usa coma decimal sin decimales sobrantes", async () => {
    const user = userEvent.setup();

    render(
      <ProductDetailPriceChangeCard currentCostRef={8} currentPriceRef={9} onSubmit={jest.fn()} />,
    );

    await user.clear(priceField());
    await user.type(priceField(), "9,5");

    expect(pctField()).toHaveValue("18.75");
    expect(reasonField()).toHaveValue("Ajuste de margen a 18,75 %");

    await user.clear(priceField());
    await user.type(priceField(), "10");

    expect(pctField()).toHaveValue("25");
    expect(reasonField()).toHaveValue("Ajuste de margen a 25 %");
  });

  it("un motivo escrito a mano no se pisa al cambiar despues el precio", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(
      <ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={12} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.clear(reasonField());
    await user.type(reasonField(), "Subió el proveedor");
    await user.click(screen.getByRole("button", { name: "12 %" }));

    expect(priceField()).toHaveValue("11.2");
    expect(reasonField()).toHaveValue("Subió el proveedor");

    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(11.2, "Subió el proveedor");
  });

  it("un precio por debajo del costo avisa con % negativo y no bloquea", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(
      <ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={12} onSubmit={onSubmit} />,
    );

    await user.clear(priceField());
    await user.type(priceField(), "9");

    expect(screen.getByTitle(BADGE_TITLE)).toHaveAttribute("data-band", "low");
    expect(screen.getByText("El precio está por debajo del costo.")).toBeVisible();
    expect(reasonField()).toHaveValue("Ajuste de margen a -10 %");

    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toBe(9);
  });

  it("sin costo no hay % que proponer: no prellena motivo y el precio a mano se envia", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(
      <ProductDetailPriceChangeCard currentCostRef={0} currentPriceRef={5} onSubmit={onSubmit} />,
    );

    expect(screen.getByTitle(BADGE_TITLE)).toHaveTextContent("Sin costo");

    await user.clear(priceField());
    await user.type(priceField(), "6");

    expect(reasonField()).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(6, "");
  });

  it("un precio vacio no se envia (ni como 0) y avisa en el campo", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(
      <ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={12} onSubmit={onSubmit} />,
    );

    await user.clear(priceField());
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(priceField()).toHaveAccessibleDescription("Escribe el nuevo precio.");
  });

  it("tras un cambio confirmado el precio se realinea y el motivo vuelve a proponerse", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { rerender } = render(
      <ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={12} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.clear(reasonField());
    await user.type(reasonField(), "Subió el proveedor");

    rerender(
      <ProductDetailPriceChangeCard currentCostRef={10} currentPriceRef={13} onSubmit={onSubmit} />,
    );

    expect(priceField()).toHaveValue("13");
    expect(reasonField()).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "20 %" }));

    expect(priceField()).toHaveValue("12");
    expect(reasonField()).toHaveValue("Ajuste de margen a 20 %");
  });
});
