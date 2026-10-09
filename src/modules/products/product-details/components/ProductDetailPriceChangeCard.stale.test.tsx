/**
 * CAOS-04 · cambio de precio con efecto rancio: al abrir la confirmación se relee
 * el producto y el «antes → después» se pinta con el precio y el costo frescos; si
 * cambiaron respecto a lo que había en el formulario, se avisa. Tras guardar, el
 * aviso de éxito dice lo que devolvió el servidor.
 */
import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";

import { ProductDetailPriceChangeCard } from "./ProductDetailPriceChangeCard";

type CardProps = React.ComponentProps<typeof ProductDetailPriceChangeCard>;
type Fresh = Awaited<ReturnType<NonNullable<CardProps["onRefreshProduct"]>>>;

const unchanged: Fresh = { currentCostRef: 2.1, currentPriceRef: 3.5 };

function renderCard(props: Partial<CardProps> = {}) {
  const onSubmit = jest.fn<ReturnType<CardProps["onSubmit"]>, [number, string, number]>();

  onSubmit.mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <ProductDetailPriceChangeCard
        currentCostRef={2.1}
        currentPriceRef={3.5}
        onSubmit={onSubmit}
        productName="Harina PAN 1 kg"
        {...props}
      />
    </ToastProvider>,
  );

  return { onSubmit, user: userEvent.setup() };
}

/** Teclea el precio nuevo y abre la confirmación. */
async function openConfirm(user: ReturnType<typeof userEvent.setup>, value = "4.20") {
  const field = screen.getByLabelText("Precio REF");

  await user.clear(field);
  await user.type(field, value);
  await user.click(screen.getByRole("button", { name: "Actualizar precio" }));

  return within(await screen.findByRole("dialog", { name: "Confirmar cambio de precio" }));
}

const CONFIRM = { name: "Cambiar precio" };

describe("ProductDetailPriceChangeCard · el efecto se pinta con el dato releído (CAOS-04)", () => {
  it("mientras relee no deja confirmar; si otro cambió el precio lo avisa y el antes → después usa el fresco", async () => {
    let release: (fresh: Fresh) => void = () => undefined;
    const onRefreshProduct = jest.fn(
      () =>
        new Promise<Fresh>((resolve) => {
          release = resolve;
        }),
    );
    const { onSubmit, user } = renderCard({ onRefreshProduct });
    const dialog = await openConfirm(user);

    expect(await dialog.findByText("Comprobando el precio actual…")).toBeInTheDocument();
    expect(dialog.queryByRole("button", CONFIRM)).not.toBeInTheDocument();
    expect(dialog.queryByTestId("price-change-effect")).not.toBeInTheDocument();
    expect(screen.queryByText(/pasa de ref 3\.50/)).not.toBeInTheDocument();
    expect(onRefreshProduct).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ currentCostRef: 2.1, currentPriceRef: 9 });
    });

    expect(
      await dialog.findByText("El precio cambió mientras editabas: ahora es ref 9.00."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("El precio de Harina PAN 1 kg pasa de ref 9.00 a ref 4.20."),
    ).toBeInTheDocument();
    expect(dialog.getByTestId("price-change-effect")).toHaveTextContent(
      /Precio\s*ref 9\.00\s*pasa a\s*ref 4\.20/,
    );
    expect(dialog.getByTestId("price-change-effect")).toHaveAttribute("data-direction", "down");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(dialog.getByRole("button", CONFIRM));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(4.2, "Ajuste de margen a 100 %", 2.1);
  });

  it("si nada cambió no hay aviso y el efecto es el de siempre", async () => {
    const { user } = renderCard({ onRefreshProduct: () => Promise.resolve(unchanged) });
    const dialog = await openConfirm(user);

    expect(await dialog.findByTestId("price-change-effect")).toHaveTextContent(
      /Precio\s*ref 3\.50\s*pasa a\s*ref 4\.20/,
    );
    expect(screen.queryByText(/mientras editabas/)).not.toBeInTheDocument();
  });

  it("si cambió el costo lo avisa, recalcula la ganancia y envía el costo fresco como esperado", async () => {
    const { onSubmit, user } = renderCard({
      onRefreshProduct: () => Promise.resolve({ currentCostRef: 3, currentPriceRef: 3.5 }),
    });
    const dialog = await openConfirm(user);

    expect(
      await dialog.findByText("El costo cambió mientras editabas: ahora es ref 3.00."),
    ).toBeInTheDocument();
    expect(dialog.getByTestId("price-change-effect")).toHaveTextContent(
      "Motivo: Ajuste de margen a 40 %",
    );

    await user.click(dialog.getByRole("button", CONFIRM));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(4.2, "Ajuste de margen a 40 %", 3));
  });

  it("si la relectura falla lo dice, no deja confirmar a ciegas y se puede reintentar", async () => {
    const onRefreshProduct = jest
      .fn<Promise<Fresh>, []>()
      .mockRejectedValueOnce(new Error("sin red"))
      .mockResolvedValueOnce(unchanged);
    const { onSubmit, user } = renderCard({ onRefreshProduct });
    const dialog = await openConfirm(user);

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "No se pudo comprobar el precio actual.",
    );
    expect(dialog.queryByRole("button", CONFIRM)).not.toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Reintentar" }));

    expect(await dialog.findByRole("button", CONFIRM)).toBeEnabled();
    expect(onRefreshProduct).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("si el precio ya es el que se iba a poner, se bloquea: no hay nada que cambiar", async () => {
    const { onSubmit, user } = renderCard({
      onRefreshProduct: () => Promise.resolve({ currentCostRef: 2.1, currentPriceRef: 4.2 }),
    });
    const dialog = await openConfirm(user);

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "El precio ya es ref 4.20: no hay nada que cambiar.",
    );
    expect(dialog.queryByRole("button", CONFIRM)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("tras un guardado rechazado relee sin tapar el efecto, y el reintento viaja con el costo fresco", async () => {
    const onRefreshProduct = jest
      .fn<Promise<Fresh>, []>()
      .mockResolvedValueOnce(unchanged)
      .mockResolvedValueOnce({ currentCostRef: 3, currentPriceRef: 3.5 });
    const { onSubmit, user } = renderCard({ onRefreshProduct });

    onSubmit.mockRejectedValueOnce(new Error("El costo cambió de 2.10 a 3.00; revisa el precio"));

    const dialog = await openConfirm(user);

    await user.click(await dialog.findByRole("button", CONFIRM));

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "El costo cambió de 2.10 a 3.00; revisa el precio",
    );
    expect(screen.queryByText("Comprobando el precio actual…")).not.toBeInTheDocument();
    expect(
      await dialog.findByText("El costo cambió mientras editabas: ahora es ref 3.00."),
    ).toBeInTheDocument();

    await user.click(dialog.getByRole("button", CONFIRM));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[0][2]).toBe(2.1);
    expect(onSubmit.mock.calls[1][2]).toBe(3);
  });

  it("cada apertura relee", async () => {
    const onRefreshProduct = jest.fn<Promise<Fresh>, []>().mockResolvedValue(unchanged);
    const { user } = renderCard({ onRefreshProduct });
    const dialog = await openConfirm(user);

    await dialog.findByRole("button", CONFIRM);
    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));
    await within(await screen.findByRole("dialog")).findByRole("button", CONFIRM);

    expect(onRefreshProduct).toHaveBeenCalledTimes(2);
  });
});

describe("ProductDetailPriceChangeCard · el éxito dice lo que guardó el servidor (CAOS-04)", () => {
  async function confirmWith(result: Awaited<ReturnType<CardProps["onSubmit"]>>) {
    const { onSubmit, user } = renderCard({ onRefreshProduct: () => Promise.resolve(unchanged) });

    onSubmit.mockResolvedValue(result);
    await user.click(await (await openConfirm(user)).findByRole("button", CONFIRM));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  }

  it("dice el precio guardado", async () => {
    await confirmWith({ previousSalePriceRef: 3.5, salePriceRef: 4.2 });

    expect(await screen.findByText("Precio actualizado: ref 4.20")).toBeInTheDocument();
    expect(screen.queryByText(/Sustituyó/)).not.toBeInTheDocument();
  });

  it("si entre la relectura y el envío entró otro cambio, dice qué precio sustituyó de verdad", async () => {
    await confirmWith({ previousSalePriceRef: 9, salePriceRef: 4.2 });

    expect(await screen.findByText("Precio actualizado: ref 4.20")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sustituyó a ref 9.00, no a ref 3.50: otro cambio de precio entró mientras confirmabas.",
      ),
    ).toBeInTheDocument();
  });

  it("si quien guarda no devuelve el resultado, avisa del éxito sin inventar cifras del servidor", async () => {
    await confirmWith(undefined);

    expect(await screen.findByText("Precio actualizado: ref 4.20")).toBeInTheDocument();
    expect(screen.queryByText(/Sustituyó/)).not.toBeInTheDocument();
  });
});
