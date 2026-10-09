import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** CNF-07: "Actualizar precio" abre la confirmación; el envío ocurre al confirmar. */
async function confirmDialog() {
  return within(await screen.findByRole("dialog", { name: "Confirmar cambio de precio" }));
}

async function confirmPriceChange(user: ReturnType<typeof userEvent.setup>) {
  await user.click((await confirmDialog()).getByRole("button", { name: "Cambiar precio" }));
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
    await confirmPriceChange(user);

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
    // Sin cambio no hay nada que confirmar: ni siquiera se abre el modal.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    await confirmPriceChange(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(13, "Ajuste de margen a 30 %", 10);
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
    await confirmPriceChange(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(11.2, "Subió el proveedor", 10);
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
    await confirmPriceChange(user);

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
    await confirmPriceChange(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(6, "", 0);
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

  it("PRO-09: usa los chips y el semaforo de la tienda y ofrece primero el % de la categoria", () => {
    render(
      <ProductDetailPriceChangeCard
        categoryMarkupPct={18}
        currentCostRef={10}
        currentPriceRef={12}
        onSubmit={jest.fn()}
        pricing={{ chipsPct: [10, 40], greenFromPct: 18, yellowFromPct: 8 }}
      />,
    );

    const chips = within(
      screen.getByRole("group", { name: "Porcentajes de ganancia recomendados" }),
    ).getAllByRole("button");

    expect(chips.map((chip) => chip.textContent)).toEqual(["Sugerido 18 %", "10 %", "40 %"]);
    // 20 % es verde porque la tienda fija el verde en 18 %.
    expect(screen.getByTitle(BADGE_TITLE)).toHaveAttribute("data-band", "high");
    // Ofrecer el % no mueve el precio.
    expect(priceField()).toHaveValue("12");
  });

  it("PRO-09: sin ajustes de la tienda (cargando o error) usa los valores por defecto", () => {
    render(
      <ProductDetailPriceChangeCard
        currentCostRef={10}
        currentPriceRef={12}
        onSubmit={jest.fn()}
        pricing={undefined}
      />,
    );

    const chips = within(
      screen.getByRole("group", { name: "Porcentajes de ganancia recomendados" }),
    ).getAllByRole("button");

    expect(chips.map((chip) => chip.textContent)).toEqual(["12 %", "20 %", "30 %"]);
    expect(screen.getByTitle(BADGE_TITLE)).toHaveAttribute("data-band", "mid");
  });
});

describe("ProductDetailPriceChangeCard · confirmación del cambio (CNF-07)", () => {
  type CardProps = React.ComponentProps<typeof ProductDetailPriceChangeCard>;

  function renderCard(props: Partial<CardProps> = {}) {
    const onSubmit = jest.fn<Promise<void>, [number, string, number]>().mockResolvedValue(undefined);

    render(
      <ProductDetailPriceChangeCard
        currentCostRef={10}
        currentPriceRef={12}
        onSubmit={onSubmit}
        productName="Harina PAN 1 kg"
        rateVes={40}
        {...props}
      />,
    );

    return { onSubmit, user: userEvent.setup() };
  }

  it("muestra precio anterior → nuevo en REF y Bs, ganancia anterior → nueva con semáforo y el motivo", async () => {
    const { onSubmit, user } = renderCard();

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    const dialog = await confirmDialog();

    expect(
      dialog.getByText("El precio de Harina PAN 1 kg pasa de ref 12.00 a ref 13.00."),
    ).toBeInTheDocument();

    const effect = dialog.getByTestId("price-change-effect");

    expect(effect).toHaveAttribute("data-direction", "up");
    expect(effect).toHaveTextContent(/Precio\s*ref 12\.00\s*pasa a\s*ref 13\.00/);
    // Bs a la tasa vigente (40): 12 × 40 = 480 y 13 × 40 = 520.
    expect(effect).toHaveTextContent(/Bs\. 480,00\s*pasa a\s*Bs\. 520,00/);

    const badges = within(effect).getAllByTitle(BADGE_TITLE);

    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("20 %");
    expect(badges[0]).toHaveAttribute("data-band", "mid");
    expect(badges[1]).toHaveTextContent("30 %");
    expect(badges[1]).toHaveAttribute("data-band", "high");
    expect(effect).toHaveTextContent("Motivo: Ajuste de margen a 30 %");
    expect(dialog.queryByRole("note")).not.toBeInTheDocument();
    // Abrir la confirmación no guarda nada.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("el semáforo de la confirmación usa los cortes de la tienda", async () => {
    const { user } = renderCard({ pricing: { chipsPct: [30], greenFromPct: 40, yellowFromPct: 25 } });

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    const badges = within((await confirmDialog()).getByTestId("price-change-effect")).getAllByTitle(
      BADGE_TITLE,
    );

    expect(badges[0]).toHaveAttribute("data-band", "low");
    expect(badges[1]).toHaveAttribute("data-band", "mid");
  });

  it("sin tasa vigente no inventa el Bs: solo muestra el cambio en REF", async () => {
    const { user } = renderCard({ rateVes: undefined });

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    const effect = (await confirmDialog()).getByTestId("price-change-effect");

    expect(effect).toHaveTextContent("ref 13.00");
    expect(effect).not.toHaveTextContent("Bs.");
  });

  it("cancelar no llama al guardado y deja el formulario como estaba", async () => {
    const { onSubmit, user } = renderCard();

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));
    await user.click((await confirmDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(priceField()).toHaveValue("13");
  });

  it("doble clic en Actualizar precio y doble clic al confirmar: UNA sola llamada, y cierra al terminar", async () => {
    let finish: () => void = () => undefined;
    const onSubmit = jest.fn<Promise<void>, [number, string, number]>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { user } = renderCard({ onSubmit });

    await user.click(screen.getByRole("button", { name: "30 %" }));

    const submit = screen.getByRole("button", { name: "Actualizar precio" });

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
    // Abrir la confirmación, aunque sea con doble clic, no envía nada.
    expect(onSubmit).not.toHaveBeenCalled();

    const confirm = (await confirmDialog()).getByRole("button", { name: "Cambiar precio" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(13, "Ajuste de margen a 30 %", 10);

    finish();

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Guardado y aún sin releer: otro clic no vuelve a abrir ni a enviar el mismo precio.
    fireEvent.click(screen.getByRole("button", { name: "Actualizar precio" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("un error del servidor se muestra tal cual en el modal, que sigue abierto y deja reintentar", async () => {
    const onSubmit = jest
      .fn<Promise<void>, [number, string, number]>()
      .mockRejectedValueOnce(new Error("El costo cambió de ref 10.00 a ref 11.00."))
      .mockResolvedValueOnce(undefined);
    const { user } = renderCard({ onSubmit });

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    const dialog = await confirmDialog();

    await user.click(dialog.getByRole("button", { name: "Cambiar precio" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "El costo cambió de ref 10.00 a ref 11.00.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Cambiar precio" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("un precio nuevo por debajo del costo se avisa en tono de peligro, sin bloquear", async () => {
    const { onSubmit, user } = renderCard();

    await user.clear(priceField());
    await user.type(priceField(), "9");
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    const dialog = await confirmDialog();
    const warning = dialog.getByRole("note");

    expect(warning).toHaveAttribute("data-tone", "danger");
    expect(warning).toHaveTextContent(
      "El precio nuevo queda por debajo del costo (ref 10.00): cada venta sería a pérdida.",
    );
    expect(dialog.getByTestId("price-change-effect")).toHaveAttribute("data-direction", "down");
    // Es un aviso, no un bloqueo (regla 10b): se puede confirmar.
    await user.click(dialog.getByRole("button", { name: "Cambiar precio" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(9, "Ajuste de margen a -10 %", 10));
  });

  it("un precio igual al costo no es por debajo del costo", async () => {
    const { user } = renderCard();

    await user.clear(priceField());
    await user.type(priceField(), "10");
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    expect((await confirmDialog()).queryByRole("note")).not.toBeInTheDocument();
  });

  it("un lector de códigos con la confirmación abierta no cambia el precio (CNF-F7 · CAOS-01)", async () => {
    const { onSubmit, user } = renderCard();

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

    const dialog = await confirmDialog();

    expect(dialog.getByRole("button", { name: "Cambiar precio" })).toHaveFocus();

    await userEvent.setup({ delay: null }).keyboard("7591234567895{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog.getByRole("button", { name: "Cambiar precio" })).toBeEnabled();
  });
});
