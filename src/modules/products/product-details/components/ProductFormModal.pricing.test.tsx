/**
 * PRO-08 · bloque de precio del formulario de producto (`PricingFields`):
 * un chip o un % completan el precio, editar el precio recalcula el %, y el
 * precio nunca se mueve sin que el usuario lo pida.
 * PRO-F4 · el % libre se revela con "Otro %" (un campo menos al abrir) y el
 * costo se ve una sola vez (el campo "Costo REF").
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductFormModal } from "./ProductFormModal";

jest.mock("../../../../shared/auth/Can", () => ({
  Can: () => null,
}));

// Sin configuración de la tienda: el formulario usa los chips y el semáforo por defecto.
jest.mock("../../../settings/hooks/useSettings", () => ({
  usePricingSettings: () => ({ data: undefined }),
}));

jest.mock("../../hooks/useProducts", () => ({
  useProducts: () => ({ data: undefined }),
}));

jest.mock("../../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

type UserSession = ReturnType<typeof userEvent.setup>;
type ProductProp = NonNullable<Parameters<typeof ProductFormModal>[0]["product"]>;

const BADGE_TITLE = "Ganancia sobre el costo (ya con IVA)";

const product = {
  barcode: null,
  categoryId: "cat-1",
  currentCostRef: 10,
  currentStock: 7,
  id: "prod-1",
  minStock: 2,
  name: "Cola 2 L",
  salePriceRef: 12,
  sku: "cola-2l",
} as unknown as ProductProp;

function costField() {
  return screen.getByLabelText("Costo REF");
}

function pctField() {
  return screen.getByLabelText("Ganancia %");
}

function queryPctField() {
  return screen.queryByLabelText("Ganancia %");
}

/** El % libre no está a la vista al abrir: se pide con el chip "Otro %". */
async function revealPctField(user: UserSession) {
  await user.click(screen.getByRole("button", { name: "Otro %" }));

  return pctField();
}

function priceField() {
  return screen.getByLabelText("Precio REF");
}

function chips() {
  return within(
    screen.getByRole("group", { name: "Porcentajes de ganancia recomendados" }),
  ).getAllByRole("button");
}

async function fillName(user: UserSession, name = "Harina") {
  await user.click(screen.getByLabelText("Nombre"));
  await user.paste(name);
}

async function save(user: UserSession, label = "Crear producto") {
  await user.click(screen.getByRole("button", { name: label }));
}

describe("ProductFormModal · bloque de precio (PRO-08)", () => {
  it("con el costo escrito, un clic en el chip 30 deja el precio listo y viaja en el payload", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);

    expect(chips().map((chip) => chip.textContent)).toEqual(["12 %", "20 %", "30 %"]);

    await fillName(user);
    await user.type(costField(), "10");
    await user.click(screen.getByRole("button", { name: "30 %" }));

    expect(priceField()).toHaveValue("13");
    expect(screen.getByRole("button", { name: "30 %" })).toHaveAttribute("aria-pressed", "true");
    // Un solo clic: el chip no obliga a abrir el % libre.
    expect(queryPctField()).not.toBeInTheDocument();

    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      currentCostRef: 10,
      name: "Harina",
      salePriceRef: 13,
    });
  });

  it("escribir un % libre completa el precio", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillName(user);
    await user.type(costField(), "8");
    await user.type(await revealPctField(user), "25");

    expect(priceField()).toHaveValue("10");

    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ currentCostRef: 8, salePriceRef: 10 });
  });

  it("editar el precio recalcula el % y el semaforo", async () => {
    const user = userEvent.setup({ delay: null });

    render(<ProductFormModal onOpenChange={jest.fn()} open />);
    await user.type(costField(), "10");
    await user.type(priceField(), "12");

    expect(screen.getByRole("button", { name: "20 %" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle(BADGE_TITLE)).toHaveTextContent("20 %");

    await user.clear(priceField());
    await user.type(priceField(), "15");

    expect(screen.getByTitle(BADGE_TITLE)).toHaveTextContent("50 %");
    expect(await revealPctField(user)).toHaveValue("50");
  });

  it("cambiar el costo no mueve el precio: solo recalcula el %", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillName(user);
    await user.type(costField(), "10");
    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.clear(costField());
    await user.type(costField(), "8");

    expect(priceField()).toHaveValue("13");
    expect(screen.getByTitle(BADGE_TITLE)).toHaveTextContent("62,5 %");

    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ currentCostRef: 8, salePriceRef: 13 });
  });

  it("sin costo, un % deja el precio en 0 con aviso y el precio escrito a mano se guarda", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillName(user);
    await user.click(screen.getByRole("button", { name: "30 %" }));

    expect(priceField()).toHaveValue("0");
    expect(screen.getByText(/Este producto no tiene costo/)).toBeVisible();
    expect(screen.getByTitle(BADGE_TITLE)).toHaveTextContent("Sin costo");

    await user.clear(priceField());
    await user.type(priceField(), "5");
    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ salePriceRef: 5 });
    expect(onSubmit.mock.calls[0][0].currentCostRef).toBeUndefined();
  });

  it("un costo 0 escrito se trata como sin costo y no bloquea", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillName(user);
    await user.type(costField(), "0");
    await user.type(await revealPctField(user), "20");

    expect(priceField()).toHaveValue("0");
    expect(screen.getByText(/Este producto no tiene costo/)).toBeVisible();

    await user.clear(priceField());
    await user.type(priceField(), "3");
    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ currentCostRef: 0, salePriceRef: 3 });
  });

  it("un precio por debajo del costo avisa en rojo con % negativo y no bloquea el guardado", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillName(user);
    await user.type(costField(), "10");
    await user.type(priceField(), "8");

    const badge = screen.getByTitle(BADGE_TITLE);

    expect(badge).toHaveAttribute("data-band", "low");
    expect(badge).toHaveTextContent("-20 %");
    expect(screen.getByText("El precio está por debajo del costo.")).toBeVisible();

    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ currentCostRef: 10, salePriceRef: 8 });
  });

  it("el precio sigue siendo obligatorio: vacio no se envia, avisa y recibe el foco", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillName(user);
    await user.type(costField(), "10");
    await save(user);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(priceField()).toHaveAccessibleDescription("Escribe el precio de venta.");
    expect(priceField()).toHaveFocus();

    // Al escribirlo el aviso desaparece y se guarda.
    await user.type(priceField(), "11");

    expect(priceField()).not.toHaveAccessibleDescription();

    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ salePriceRef: 11 });
  });

  it("un precio 0 escrito a mano es un precio: se envia", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillName(user);
    await user.type(priceField(), "0");
    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ salePriceRef: 0 });
  });

  it("compact: precarga costo y precio de initialValues, muestra su % y un chip lo reprecia", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(
      <ProductFormModal
        compact
        initialValues={{ currentCostRef: 10, name: "Harina PAN 1 kg", salePriceRef: 12 }}
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
        open
      />,
    );

    expect(costField()).toHaveValue("10");
    expect(priceField()).toHaveValue("12");
    expect(screen.getByRole("button", { name: "20 %" })).toHaveAttribute("aria-pressed", "true");
    expect(queryPctField()).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "30 %" }));
    await save(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      currentCostRef: 10,
      name: "Harina PAN 1 kg",
      salePriceRef: 13,
    });
  });

  it("compact: solo con el costo precargado no inventa un precio", () => {
    render(
      <ProductFormModal
        compact
        initialValues={{ currentCostRef: 1.5 }}
        onOpenChange={jest.fn()}
        open
      />,
    );

    expect(costField()).toHaveValue("1.5");
    expect(priceField()).toHaveValue("");
    expect(queryPctField()).not.toBeInTheDocument();
  });

  it("compact: un precio precargado cuyo % no es ningun chip abre con el % libre ya a la vista", () => {
    render(
      <ProductFormModal
        compact
        initialValues={{ currentCostRef: 8, salePriceRef: 10 }}
        onOpenChange={jest.fn()}
        open
      />,
    );

    expect(pctField()).toHaveValue("25");
    expect(screen.queryByRole("button", { name: "Otro %" })).not.toBeInTheDocument();
  });

  it("el costo se ve una sola vez: el campo Costo REF, sin la caja de solo lectura", async () => {
    const user = userEvent.setup({ delay: null });

    render(<ProductFormModal onOpenChange={jest.fn()} open />);

    expect(screen.queryByText("Costo actual (ya con IVA)")).not.toBeInTheDocument();

    await user.type(costField(), "10");
    await user.type(priceField(), "12");

    expect(screen.queryByText("Costo actual (ya con IVA)")).not.toBeInTheDocument();
    expect(screen.queryByText("ref 10.00")).not.toBeInTheDocument();
    // El semáforo sigue ahí.
    expect(screen.getByTitle(BADGE_TITLE)).toHaveTextContent("20 %");
  });

  it("edicion: abrir y guardar no mueve el precio, ni siquiera uno con mas de 2 decimales", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(
      <ProductFormModal
        mode="edit"
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
        open
        product={{ ...product, salePriceRef: 12.345 }}
      />,
    );

    await save(user, "Guardar cambios");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ currentCostRef: 10, salePriceRef: 12.345 });
  });

  it("edicion: cambiar el costo deja el precio como estaba", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(
      <ProductFormModal
        mode="edit"
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
        open
        product={product}
      />,
    );

    expect(priceField()).toHaveValue("12");
    expect(screen.getByRole("button", { name: "20 %" })).toHaveAttribute("aria-pressed", "true");

    await user.clear(costField());
    await user.type(costField(), "11");

    expect(priceField()).toHaveValue("12");

    await save(user, "Guardar cambios");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ currentCostRef: 11, salePriceRef: 12 });
  });

  it("pricingChips y suggestedMarkupPct: el sugerido va primero y destacado, y solo se ofrece", async () => {
    const user = userEvent.setup({ delay: null });

    render(
      <ProductFormModal
        initialValues={{ currentCostRef: 10 }}
        onOpenChange={jest.fn()}
        open
        pricingChips={[10, 40]}
        suggestedMarkupPct={18}
      />,
    );

    expect(chips().map((chip) => chip.textContent)).toEqual(["Sugerido 18 %", "10 %", "40 %"]);
    // Ofrecer el % no fija ningún precio.
    expect(priceField()).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Sugerido 18 %" }));

    expect(priceField()).toHaveValue("11.8");
  });

  it("Guardar y crear otro deja el bloque de precio vacio para el siguiente", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillName(user);
    await user.type(costField(), "10");
    await user.click(screen.getByRole("button", { name: "30 %" }));
    await save(user, "Guardar y crear otro");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(costField()).toHaveValue("");
    expect(priceField()).toHaveValue("");
    expect(queryPctField()).not.toBeInTheDocument();
  });

  it("Guardar y crear otro vuelve a plegar el % libre que se habia abierto", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillName(user);
    await user.type(costField(), "8");
    await user.type(await revealPctField(user), "25");
    await save(user, "Guardar y crear otro");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ currentCostRef: 8, salePriceRef: 10 });
    expect(queryPctField()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Otro %" })).toBeInTheDocument();
  });
});
