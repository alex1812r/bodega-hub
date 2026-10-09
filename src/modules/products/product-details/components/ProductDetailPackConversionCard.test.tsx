import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import {
  createQueryWrapper,
  installFetchStub,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import { ProductDetailPackConversionCard } from "./ProductDetailPackConversionCard";

const packConversion = {
  id: "ppc-cigars",
  linkedProduct: { currentStock: 3, id: "prod-cigar-unit", name: "Cigarro suelto" },
  role: "pack",
  unitsPerPack: 10,
} as unknown as ProductPackConversionSummary;

const conversionResult = { data: { conversionId: "conv-1", unitQuantity: 10 } };

function renderCard(onConverted = jest.fn(), productStock = 5) {
  render(
    <ProductDetailPackConversionCard
      onConverted={onConverted}
      packConversion={packConversion}
      productId="prod-cigar-pack"
      productName="Caja cigarros (x10)"
      productStock={productStock}
    />,
    { wrapper: createQueryWrapper() },
  );

  return onConverted;
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir empaque" }));
  await screen.findByLabelText("Cantidad de empaques");
}

function getForm() {
  const form = document.getElementById("open-pack-form");

  if (!form) {
    throw new Error("El formulario de abrir empaque no esta montado.");
  }

  return form;
}

/** CNF-F2: el 1 a 1 ya no envía desde el formulario; lo hace el botón de su confirmación. */
async function findConfirm() {
  return screen.findByRole("dialog", { name: "Confirmar conversión de empaque" });
}

async function confirmConversion() {
  const dialog = await findConfirm();

  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Convertir empaque" })).toBeEnabled(),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Convertir empaque" }));

  return dialog;
}

describe("ProductDetailPackConversionCard · idempotencia (C6)", () => {
  it("doble envio = un solo POST, con clave, y el boton queda deshabilitado", async () => {
    const api = installFetchStub(() => null);
    const release = api.holdNextPost(conversionResult);
    const onConverted = renderCard();

    await openDialog();
    fireEvent.submit(getForm());
    fireEvent.submit(getForm());

    // El formulario, aunque se envíe dos veces, no manda nada: abre UNA confirmación.
    const dialog = await findConfirm();
    expect(screen.getAllByRole("dialog", { name: "Confirmar conversión de empaque" })).toHaveLength(1);
    expect(api.posts).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Convertir empaque" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Convertir empaque|Procesando/ }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Procesando..." })).toBeDisabled(),
    );
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/conversions");
    expect(api.posts[0]?.body).toMatchObject({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      packProductId: "prod-cigar-pack",
      packQuantity: 1,
    });
    expect(onConverted).not.toHaveBeenCalled();

    await act(async () => {
      release();
    });
    // El exito lo confirma el servidor: solo entonces se cierra y se avisa.
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));
    expect(api.posts).toHaveLength(1);
  });

  it("el reintento tras un error de red reutiliza la misma clave", async () => {
    const api = installFetchStub(() => null);
    api.networkErrorOnNextPost();
    api.respondToNextPost(conversionResult);
    const onConverted = renderCard();

    await openDialog();
    fireEvent.submit(getForm());
    const dialog = await confirmConversion();
    await within(dialog).findByText(/No pudimos confirmar si el movimiento se registró/);
    expect(onConverted).not.toHaveBeenCalled();

    // El reintento se hace desde la misma confirmación, que sigue abierta con el error.
    await confirmConversion();
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
  });
});

describe("ProductDetailPackConversionCard · aviso de cantidad (SHR-09G)", () => {
  function getQuantityInput() {
    return screen.getByLabelText<HTMLInputElement>("Cantidad de empaques");
  }

  it("al abrir no muestra ningun aviso", async () => {
    installFetchStub(() => null);
    renderCard();
    await openDialog();

    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Indica una cantidad mayor a cero.")).not.toBeInTheDocument();
  });

  it.each(["0", ""])("cantidad %p: avisa y no envia", async (value) => {
    const api = installFetchStub(() => null);
    const onConverted = renderCard();

    await openDialog();
    fireEvent.change(getQuantityInput(), { target: { value } });

    expect(screen.getByText("Indica una cantidad mayor a cero.")).toBeVisible();
    expect(getQuantityInput()).toHaveAttribute("aria-invalid", "true");
    expect(getQuantityInput()).toHaveAccessibleDescription("Indica una cantidad mayor a cero.");

    fireEvent.submit(getForm());

    expect(api.posts).toHaveLength(0);
    expect(onConverted).not.toHaveBeenCalled();
  });

  it("cantidad valida: un solo POST con el mismo payload de siempre", async () => {
    const api = installFetchStub(() => null);
    api.respondToNextPost(conversionResult);
    const onConverted = renderCard();

    await openDialog();
    fireEvent.change(getQuantityInput(), { target: { value: "2" } });
    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");

    fireEvent.submit(getForm());
    await findConfirm();
    expect(api.posts).toHaveLength(0);
    await confirmConversion();
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/conversions");
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      packProductId: "prod-cigar-pack",
      packQuantity: 2,
    });
  });
});

describe("ProductDetailPackConversionCard · stock insuficiente (STK-607)", () => {
  function getQuantityInput() {
    return screen.getByLabelText<HTMLInputElement>("Cantidad de empaques");
  }

  it("sin stock: aviso propio en español, sin validacion nativa y sin POST", async () => {
    const api = installFetchStub(() => null);
    const onConverted = renderCard(jest.fn(), 0);

    await openDialog();

    expect(screen.getByText("No hay empaques en stock para abrir.")).toBeVisible();
    expect(getQuantityInput()).toHaveAttribute("aria-invalid", "true");
    // Sin `max`: el navegador no pinta su burbuja («Minimum value (1) must be less than…»).
    expect(getQuantityInput().validity.valid).toBe(true);

    fireEvent.submit(getForm());

    expect(api.posts).toHaveLength(0);
    expect(onConverted).not.toHaveBeenCalled();
  });

  it("cantidad mayor que el stock: dice cuantos empaques hay y no envia", async () => {
    const api = installFetchStub(() => null);

    renderCard();
    await openDialog();
    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");

    fireEvent.change(getQuantityInput(), { target: { value: "6" } });

    expect(screen.getByText("Solo hay 5 empaque(s) en stock.")).toBeVisible();
    expect(getQuantityInput().validity.valid).toBe(true);

    fireEvent.submit(getForm());

    expect(api.posts).toHaveLength(0);
  });
});

describe("ProductDetailPackConversionCard · cantidad entera (SHR-09J)", () => {
  it.each(["2.5", "2,5"])("cantidad %p: se ve 2.5, avisa y no envia (ni con Enter ni con el boton)", async (typed) => {
    const user = userEvent.setup();
    const api = installFetchStub(() => null);
    const onConverted = renderCard();

    await openDialog();
    const quantity = screen.getByLabelText("Cantidad de empaques");

    await user.clear(quantity);
    await user.type(quantity, `${typed}{Enter}`);

    expect(quantity).toHaveValue("2.5");
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();

    fireEvent.submit(getForm());
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(api.posts).toHaveLength(0);
    expect(onConverted).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Confirmar conversión de empaque" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();
  });

  it.each(["Enter", "boton"])("cantidad 3 enviada con %s: un solo POST con el payload de siempre", async (how) => {
    const user = userEvent.setup();
    const api = installFetchStub(() => null);
    api.respondToNextPost(conversionResult);
    const onConverted = renderCard();

    await openDialog();
    const quantity = screen.getByLabelText("Cantidad de empaques");

    await user.clear(quantity);
    await user.type(quantity, "3");

    if (how === "Enter") {
      await user.keyboard("{Enter}");
    } else {
      await user.click(screen.getByRole("button", { name: "Continuar" }));
    }

    // Ni Enter ni el botón del formulario envían: llevan a la confirmación.
    await findConfirm();
    expect(api.posts).toHaveLength(0);
    await confirmConversion();
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      packProductId: "prod-cigar-pack",
      packQuantity: 3,
    });
  });
});

describe("ProductDetailPackConversionCard · surtido y orígenes (PRO-13)", () => {
  const linkedProduct = {
    currentCostRef: 0.5,
    currentStock: 4,
    id: "prod-cola",
    name: "Cola",
    salePriceRef: 1,
    sku: "cola-001",
  };

  function recipeComponent(unitProductId: string, name: string, isActive = true) {
    return {
      costWeight: 1,
      currentStock: 4,
      isActive,
      name,
      sku: `${unitProductId}-sku`,
      unitProductId,
      unitsPerPack: 2,
    };
  }

  const assorted: ProductPackConversionSummary = {
    components: [
      recipeComponent("prod-cola", "Cola"),
      recipeComponent("prod-manzana", "Manzana", false),
      recipeComponent("prod-naranja", "Naranja"),
    ],
    id: "ppc-sabores",
    kind: "assorted",
    label: "Sabores surtidos",
    linkedProduct,
    role: "pack",
    sources: [],
    totalUnits: 6,
    unitsPerPack: 6,
  };

  const unitOfTwoPacks: ProductPackConversionSummary = {
    components: [recipeComponent("prod-cola", "Cola")],
    id: "ppc-cola",
    kind: "single",
    label: null,
    linkedProduct: { ...linkedProduct, id: "prod-caja-cola", name: "Caja Cola x6" },
    role: "unit",
    sources: [
      {
        conversionId: "ppc-cola",
        packName: "Caja Cola x6",
        packProductId: "prod-caja-cola",
        totalUnits: 6,
        unitsPerPack: 6,
      },
      {
        conversionId: "ppc-sabores",
        packName: "Refrescos sabores x6",
        packProductId: "prod-sabores",
        totalUnits: 6,
        unitsPerPack: 2,
      },
    ],
    totalUnits: 6,
    unitsPerPack: 6,
  };

  function renderWith(conversion: ProductPackConversionSummary, onConverted = jest.fn()) {
    render(
      <ProductDetailPackConversionCard
        onConverted={onConverted}
        packConversion={conversion}
        productId="prod-sabores"
        productName="Refrescos sabores x6"
        productStock={5}
      />,
      { wrapper: createQueryWrapper() },
    );

    return onConverted;
  }

  it("empaque surtido: «Se abre en» con cada componente enlazado, inactivos marcados, total y nombre", () => {
    installFetchStub(() => null);
    renderWith(assorted);

    expect(
      screen.getByText((_, element) => element?.tagName === "P" && /^Se abre en:/.test(element.textContent ?? "")),
    ).toHaveTextContent("Se abre en: 2 Cola · 2 Manzana (inactivo) · 2 Naranja");
    expect(screen.getByRole("link", { name: "Cola" })).toHaveAttribute("href", "/products/prod-cola");
    expect(screen.getByRole("link", { name: "Manzana" })).toHaveAttribute(
      "href",
      "/products/prod-manzana",
    );
    expect(screen.getByRole("link", { name: "Naranja" })).toHaveAttribute(
      "href",
      "/products/prod-naranja",
    );
    expect(screen.getByText("6 unidades")).toBeVisible();
    expect(screen.getByText("Sabores surtidos")).toBeVisible();
    expect(screen.queryByText(/Proviene de/)).not.toBeInTheDocument();
  });

  it("empaque surtido: «Abrir según la receta» precarga el reparto por receta, confirma y lo envía (INV-08)", async () => {
    const api = installFetchStub(() => null);
    api.respondToNextPost(conversionResult);
    const onConverted = renderWith(assorted);

    expect(screen.queryByRole("button", { name: "Abrir empaque" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Abrir según la receta" }));
    await screen.findByLabelText("Cantidad de empaques");
    expect(screen.getByText(/Entrada: \+6 unidad\(es\)/)).toBeVisible();
    expect(screen.getByLabelText("Unidades de Cola")).toHaveValue("2");
    expect(screen.getByLabelText("Unidades de Manzana")).toHaveValue("2");
    expect(screen.getByLabelText("Unidades de Naranja")).toHaveValue("2");
    expect(screen.getByText("6 de 6 unidades")).toBeVisible();

    fireEvent.submit(getForm());

    const dialog = await screen.findByRole("dialog", { name: "Abrir empaque surtido" });

    // Nada se envía hasta confirmar.
    expect(api.posts).toHaveLength(0);
    expect(onConverted).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir empaque" }));
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/conversions");
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      components: [
        { unitProductId: "prod-cola", units: 2 },
        { unitProductId: "prod-manzana", units: 2 },
        { unitProductId: "prod-naranja", units: 2 },
      ],
      packProductId: "prod-sabores",
      packQuantity: 1,
    });
  });

  it("empaque surtido: reparto editado, suma que no coincide bloquea y la confirmación muestra el efecto (INV-08)", async () => {
    const api = installFetchStub(() => null);
    api.respondToNextPost(conversionResult);
    const onConverted = renderWith(assorted);

    fireEvent.click(screen.getByRole("button", { name: "Abrir según la receta" }));
    fireEvent.change(await screen.findByLabelText("Cantidad de empaques"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Unidades de Cola"), { target: { value: "9" } });

    expect(screen.getByText("17 de 12 unidades")).toBeVisible();
    expect(screen.getByText("Sobran 5 unidad(es): el reparto debe sumar 12.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();

    fireEvent.submit(getForm());
    expect(screen.queryByRole("dialog", { name: "Abrir empaque surtido" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restablecer receta" }));
    expect(screen.getByLabelText("Unidades de Cola")).toHaveValue("4");

    fireEvent.change(screen.getByLabelText("Unidades de Cola"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Unidades de Manzana"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Unidades de Naranja"), { target: { value: "3" } });
    fireEvent.submit(getForm());

    const dialog = await screen.findByRole("dialog", { name: "Abrir empaque surtido" });
    const effects = within(dialog).getAllByRole("listitem");

    // Manzana (inactivo en este surtido) recibe 0: no aparece.
    expect(effects).toHaveLength(3);
    expect(effects[0]).toHaveTextContent(/−2 Refrescos sabores x6\s*Stock 5\s*pasa a\s*3$/);
    expect(effects[1]).toHaveTextContent(/\+9 Cola\s*Stock 4\s*pasa a\s*13$/);
    expect(effects[2]).toHaveTextContent(/\+3 Naranja\s*Stock 4\s*pasa a\s*7$/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir empaque" }));
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));

    expect(api.posts[0]?.body).toMatchObject({
      components: [
        { unitProductId: "prod-cola", units: 9 },
        { unitProductId: "prod-naranja", units: 3 },
      ],
      packQuantity: 2,
    });
  });

  it("empaque surtido: más empaques de los que hay no llega a la confirmación (INV-08)", async () => {
    const api = installFetchStub(() => null);
    renderWith(assorted);

    fireEvent.click(screen.getByRole("button", { name: "Abrir según la receta" }));
    fireEvent.change(await screen.findByLabelText("Cantidad de empaques"), { target: { value: "6" } });

    expect(screen.getByText("Solo hay 5 empaque(s) en stock.")).toBeVisible();

    fireEvent.submit(getForm());

    expect(screen.queryByRole("dialog", { name: "Abrir empaque surtido" })).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
  });

  it("empaque 1 a 1: como siempre, con su unidad enlazada y «Abrir empaque»", () => {
    installFetchStub(() => null);
    renderWith({ id: "ppc-cola", linkedProduct, role: "pack", unitsPerPack: 6 });

    expect(screen.getByText("Este empaque se abre en 6 unidades.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Cola" })).toHaveAttribute("href", "/products/prod-cola");
    expect(screen.getByText("Stock de Cola")).toBeVisible();
    expect(screen.getByRole("button", { name: "Abrir empaque" })).toBeVisible();
    expect(screen.queryByText(/Se abre en:/)).not.toBeInTheDocument();
  });

  it("producto unidad de varios empaques: «Proviene de» los enlaza todos", () => {
    installFetchStub(() => null);
    renderWith(unitOfTwoPacks);

    expect(
      screen.getByText((_, element) => element?.tagName === "P" && /^Proviene de:/.test(element.textContent ?? "")),
    ).toHaveTextContent("Proviene de: Caja Cola x6, Refrescos sabores x6");
    expect(screen.getByRole("link", { name: "Caja Cola x6" })).toHaveAttribute(
      "href",
      "/products/prod-caja-cola",
    );
    expect(screen.getByRole("link", { name: "Refrescos sabores x6" })).toHaveAttribute(
      "href",
      "/products/prod-sabores",
    );
    expect(screen.getByText("6 und/caja")).toBeVisible();
    expect(screen.getByText("2 und/caja")).toBeVisible();
    // Una unidad no se abre.
    expect(screen.queryByRole("button", { name: /Abrir/ })).not.toBeInTheDocument();
  });

  it("producto unidad de un solo empaque sin `sources` (datos anteriores): «Proviene de» su empaque", () => {
    installFetchStub(() => null);
    renderWith({
      id: "ppc-cola",
      linkedProduct: { ...linkedProduct, id: "prod-caja-cola", name: "Caja Cola x6" },
      role: "unit",
      unitsPerPack: 6,
    });

    expect(screen.getByRole("link", { name: "Caja Cola x6" })).toHaveAttribute(
      "href",
      "/products/prod-caja-cola",
    );
    expect(screen.getByText("Stock de Caja Cola x6")).toBeVisible();
  });
});
