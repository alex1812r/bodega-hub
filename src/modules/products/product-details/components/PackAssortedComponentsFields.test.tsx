import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";
import { listProducts } from "@/modules/products/services/products.mock-server";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  addProductToPackComponents,
  createPackComponentRow,
  getAssortedPackErrors,
  getPackComponentsSumText,
} from "./PackAssortedComponentsFields";
import {
  createDefaultPackConversionFormState,
  type PackConversionFormState,
  packConversionStateToInput,
  ProductPackConversionFields,
} from "./ProductPackConversionFields";

/** PRO-13 · modo "Surtido (varios productos)" del vínculo de empaque. */

type UserSession = ReturnType<typeof userEvent.setup>;

const linkedProduct = {
  currentCostRef: 0.5,
  currentStock: 4,
  id: "prod-cola",
  name: "Cola",
  salePriceRef: 1,
  sku: "cola-001",
};

const assortedPack: ProductPackConversionSummary = {
  components: [
    {
      costWeight: 1,
      currentStock: 4,
      isActive: true,
      name: "Cola",
      sku: "cola-001",
      unitProductId: "prod-cola",
      unitsPerPack: 2,
    },
    {
      costWeight: 2,
      currentStock: 0,
      isActive: false,
      name: "Manzana",
      sku: "manzana-001",
      unitProductId: "prod-manzana",
      unitsPerPack: 2,
    },
    {
      costWeight: 1,
      currentStock: 9,
      isActive: true,
      name: "Naranja",
      sku: "naranja-001",
      unitProductId: "prod-naranja",
      unitsPerPack: 2,
    },
  ],
  id: "ppc-sabores",
  kind: "assorted",
  label: "Refrescos sabores",
  linkedProduct,
  role: "pack",
  sources: [],
  totalUnits: 6,
  unitsPerPack: 6,
};

function assortedState(patch: Partial<PackConversionFormState> = {}): PackConversionFormState {
  return {
    ...createDefaultPackConversionFormState(),
    enabled: true,
    mode: "assorted",
    unitsPerPack: "6",
    ...patch,
  };
}

function filledRow(unitProductId: string, unitsPerPack: string, costWeight = "1") {
  return createPackComponentRow({ costWeight, unitName: unitProductId, unitProductId, unitsPerPack });
}

/** `GET /api/products` respondido por el mock server real de productos. */
function installProductsApi() {
  const urls: URL[] = [];

  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");

    urls.push(url);

    return Promise.resolve(
      jsonResponse({ data: listProducts(url.searchParams, DEFAULT_STORE_ID) }),
    );
  }) as unknown as typeof fetch;

  return urls;
}

type HarnessProps = {
  excludeProductId?: string;
  initialState: PackConversionFormState;
  isUnitRole?: boolean;
  onState?: (state: PackConversionFormState) => void;
  packConversion?: ProductPackConversionSummary;
  showErrors?: boolean;
};

function Harness({ initialState, onState, ...props }: HarnessProps) {
  const [state, setState] = useState(initialState);

  return (
    <ProductPackConversionFields
      {...props}
      onChange={(patch) => {
        const next = { ...state, ...patch };

        onState?.(next);
        setState(next);
      }}
      productName="Refrescos sabores x6"
      state={state}
    />
  );
}

function renderFields(props: Partial<HarnessProps> = {}) {
  const onState = jest.fn<void, [PackConversionFormState]>();

  render(<Harness initialState={assortedState()} {...props} onState={onState} />);

  return {
    lastState: () => onState.mock.calls[onState.mock.calls.length - 1][0],
    user: userEvent.setup(),
  };
}

function productField(position: number) {
  return screen.getByRole("combobox", { name: `Producto ${position}` });
}

function unitsField(position: number) {
  return screen.getByLabelText(`Unidades del producto ${position}`);
}

function sumLine() {
  const line = document.querySelector("[data-pack-components-sum]");

  if (!line) {
    throw new Error("La línea de suma no está montada.");
  }

  return line;
}

async function pickProduct(user: UserSession, position: number, typed: string, name: RegExp) {
  await user.type(productField(position), typed);
  await user.click(await screen.findByRole("option", { name }));
}

describe("ProductPackConversionFields · modo surtido (PRO-13)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("elegir «Surtido (varios productos)» muestra la receta con dos filas vacías y sin pedir productos", async () => {
    const urls = installProductsApi();
    const { lastState, user } = renderFields({
      initialState: { ...createDefaultPackConversionFormState(), enabled: true },
    });

    await user.selectOptions(screen.getByLabelText("Modo de vínculo"), "assorted");

    expect(lastState().mode).toBe("assorted");
    expect(screen.getByLabelText("Nombre del surtido")).toBeVisible();
    expect(productField(1)).toHaveValue("");
    expect(productField(2)).toHaveValue("");
    expect(screen.queryByRole("combobox", { name: "Producto 3" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre unidad")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="number"]')).toBeNull();
    expect(urls).toEqual([]);
  });

  it("un surtido 2-2-2 produce el input `assorted` exacto del contrato", async () => {
    installProductsApi();
    const { lastState, user } = renderFields();

    await user.type(screen.getByLabelText("Nombre del surtido"), "  Sabores  ");
    await pickProduct(user, 1, "taladro", /Taladro percutor/);
    await user.type(unitsField(1), "2");
    await pickProduct(user, 2, "cable", /Cable THW 12/);
    await user.type(unitsField(2), "2");
    await user.click(screen.getByRole("button", { name: "Añadir producto" }));

    // La fila nueva recibe el foco en su buscador.
    expect(productField(3)).toHaveFocus();

    await pickProduct(user, 3, "martillo", /Martillo de una/);
    await user.type(unitsField(3), "2");

    expect(sumLine()).toHaveTextContent("✓ 6 de 6 unidades");
    expect(getAssortedPackErrors(lastState())).toBeUndefined();
    expect(packConversionStateToInput(lastState())).toEqual({
      components: [
        { unitProductId: "prod-drill", unitsPerPack: 2 },
        { unitProductId: "prod-cable", unitsPerPack: 2 },
        { unitProductId: "prod-hammer", unitsPerPack: 2 },
      ],
      enabled: true,
      label: "Sabores",
      mode: "assorted",
      totalUnits: 6,
    });
  });

  it("sin nombre de surtido, `label` viaja como null", () => {
    expect(
      packConversionStateToInput(
        assortedState({ components: [filledRow("a", "3"), filledRow("b", "3")] }),
      ),
    ).toMatchObject({ label: null, mode: "assorted", totalUnits: 6 });
  });

  it("la suma contra el total declarado se ve siempre, con texto y no solo color", async () => {
    installProductsApi();
    const { user } = renderFields();

    expect(sumLine()).toHaveTextContent("Suma: 0 de 6 unidades — faltan 6");

    await user.type(unitsField(1), "3");
    await user.type(unitsField(2), "2");
    expect(sumLine()).toHaveTextContent("Suma: 5 de 6 unidades — faltan 1");

    await user.clear(unitsField(2));
    await user.type(unitsField(2), "5");
    expect(sumLine()).toHaveTextContent("Suma: 8 de 6 unidades — sobran 2");

    await user.clear(unitsField(2));
    await user.type(unitsField(2), "3");
    expect(sumLine()).toHaveTextContent("✓ 6 de 6 unidades");

    await user.clear(screen.getByLabelText(/Unidades por empaque/));
    expect(sumLine()).toHaveTextContent("Suma: 6 unidades");
  });

  it("busca con packLink=not-pack: un empaque sale deshabilitado con motivo y la unidad de otro empaque es elegible", async () => {
    const urls = installProductsApi();
    const { lastState, user } = renderFields();

    await user.type(productField(1), "cig");

    const pack = await screen.findByRole("option", { name: /Caja cigarros/ });
    const unit = screen.getByRole("option", { name: /Cigarro individual/ });

    expect(pack).toHaveAttribute("aria-disabled", "true");
    expect(
      within(pack).getByText("Es un empaque con receta activa: no puede salir de otro empaque."),
    ).toBeVisible();
    expect(unit).not.toHaveAttribute("aria-disabled");

    await user.click(pack);
    expect(productField(1)).toHaveValue("cig");

    await user.click(unit);

    expect(productField(1)).toHaveValue("Cigarro individual");
    expect(lastState().components[0]).toMatchObject({
      isInactive: false,
      unitName: "Cigarro individual",
      unitProductId: "prod-cigar-unit",
    });
    expect(urls.some((url) => url.searchParams.get("packLink") === "not-pack")).toBe(true);
    expect(urls.some((url) => url.searchParams.get("packLink") === "none")).toBe(false);
    urls.forEach((url) => {
      expect(url.pathname).toBe("/api/products");
      expect(url.searchParams.get("isActive")).toBe("true");
    });
  });

  it("no ofrece el propio empaque ni guarda recientes", async () => {
    installProductsApi();
    const { user } = renderFields({ excludeProductId: "prod-drill" });

    await user.type(productField(1), "taladro");

    expect(await screen.findByText("Sin resultados para “taladro”")).toBeVisible();
    expect(
      Object.keys(window.localStorage).filter((key) => key.includes("entity-autocomplete:recents")),
    ).toEqual([]);
  });

  it("duplicado: un producto ya elegido en otra fila sale deshabilitado con aviso y no se elige", async () => {
    installProductsApi();
    const { lastState, user } = renderFields();

    await pickProduct(user, 1, "taladro", /Taladro percutor/);
    await user.type(productField(2), "taladro");

    const repeated = await screen.findByRole("option", { name: /Taladro percutor/ });

    expect(repeated).toHaveAttribute("aria-disabled", "true");
    expect(within(repeated).getByText("Ya está en otra fila de este empaque.")).toBeVisible();

    await user.click(repeated);
    await user.keyboard("{Enter}");

    expect(productField(2)).toHaveValue("taladro");
    expect(lastState().components[1].unitProductId).toBe("");
  });

  it("quitar una fila la saca de la receta y deja el foco en «Añadir producto»", async () => {
    installProductsApi();
    const { lastState, user } = renderFields({
      initialState: assortedState({
        components: [filledRow("a", "2"), filledRow("b", "2"), filledRow("c", "2")],
      }),
    });

    await user.click(screen.getByRole("button", { name: "Quitar producto 2" }));

    expect(lastState().components.map((row) => row.unitProductId)).toEqual(["a", "c"]);
    expect(screen.getByRole("button", { name: "Añadir producto" })).toHaveFocus();
    expect(sumLine()).toHaveTextContent("Suma: 4 de 6 unidades — faltan 2");
  });

  it("con 20 productos no se pueden añadir más", () => {
    installProductsApi();
    renderFields({
      initialState: assortedState({
        components: Array.from({ length: 20 }, (_, index) => filledRow(`p-${index}`, "1")),
        unitsPerPack: "20",
      }),
    });

    expect(screen.getByRole("button", { name: "Añadir producto" })).toBeDisabled();
    expect(screen.getByText("Máximo 20 productos.")).toBeVisible();
  });

  it("el peso de costo vive en «Avanzado», cerrado, con su ayuda de una línea", async () => {
    installProductsApi();
    const { lastState, user } = renderFields({
      initialState: assortedState({
        components: [
          createPackComponentRow({ unitName: "Cola", unitProductId: "a", unitsPerPack: "3" }),
          createPackComponentRow({ unitName: "Naranja", unitProductId: "b", unitsPerPack: "3" }),
        ],
      }),
    });
    const advanced = screen.getByRole("button", { name: /Avanzado/ });

    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Peso de costo de Cola")).not.toBeVisible();

    await user.click(advanced);

    expect(
      screen.getByText("Reparte el costo del empaque; 2 = el doble por unidad que los de peso 1"),
    ).toBeVisible();
    expect(screen.getByLabelText("Peso de costo de Cola")).toHaveValue("1");

    await user.clear(screen.getByLabelText("Peso de costo de Naranja"));
    await user.type(screen.getByLabelText("Peso de costo de Naranja"), "1.5");

    // El peso viaja solo si no es 1 (el servidor pone 1 por defecto).
    expect(packConversionStateToInput(lastState())).toMatchObject({
      components: [
        { unitProductId: "a", unitsPerPack: 3 },
        { costWeight: 1.5, unitProductId: "b", unitsPerPack: 3 },
      ],
    });
    expect(packConversionStateToInput(lastState())).not.toHaveProperty("components.0.costWeight");
  });

  it("un peso vacío vale 1 y uno que no es mayor que 0 abre «Avanzado» con su aviso", () => {
    installProductsApi();

    expect(
      getAssortedPackErrors(
        assortedState({ components: [filledRow("a", "3", ""), filledRow("b", "3")] }),
      ),
    ).toBeUndefined();

    renderFields({
      initialState: assortedState({
        components: [
          createPackComponentRow({ unitName: "Cola", unitProductId: "a", unitsPerPack: "3" }),
          createPackComponentRow({
            costWeight: "0",
            unitName: "Naranja",
            unitProductId: "b",
            unitsPerPack: "3",
          }),
        ],
      }),
      showErrors: true,
    });

    expect(screen.getByRole("button", { name: /Avanzado/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("Peso de costo de Naranja")).toHaveAccessibleDescription(
      "El peso debe ser mayor que 0.",
    );
  });

  it("tras intentar enviar, cada fila que no vale muestra su aviso", () => {
    installProductsApi();
    renderFields({
      initialState: assortedState({
        components: [filledRow("a", "0"), createPackComponentRow({ unitsPerPack: "2" })],
      }),
      showErrors: true,
    });

    expect(unitsField(1)).toHaveAccessibleDescription("Indica las unidades (mínimo 1).");
    expect(productField(2)).toHaveAccessibleDescription("Elige un producto o quita la fila.");
  });

  it("antes de intentar enviar no hay avisos", () => {
    installProductsApi();
    renderFields();

    expect(productField(1)).not.toHaveAttribute("aria-invalid");
    expect(unitsField(1)).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("edición: carga la receta con los nombres a la vista, sin buscar, y marca los inactivos", () => {
    const urls = installProductsApi();
    const initialState = createDefaultPackConversionFormState(assortedPack);

    renderFields({ excludeProductId: "prod-pack", initialState, packConversion: assortedPack });

    expect(screen.getByLabelText("Modo de vínculo")).toHaveValue("assorted");
    expect(screen.getByLabelText("Nombre del surtido")).toHaveValue("Refrescos sabores");
    expect(screen.getByLabelText(/Unidades por empaque/)).toHaveValue("6");
    expect([1, 2, 3].map((position) => productField(position).getAttribute("value"))).toEqual([
      "Cola",
      "Manzana",
      "Naranja",
    ]);
    expect(unitsField(2)).toHaveValue("2");
    expect(productField(2)).toHaveAccessibleDescription(
      "Inactivo: el empaque se puede guardar y vender igual.",
    );
    expect(productField(1)).not.toHaveAccessibleDescription();
    expect(sumLine()).toHaveTextContent("✓ 6 de 6 unidades");
    expect(urls).toEqual([]);
    // Un componente inactivo no bloquea el guardado.
    expect(getAssortedPackErrors(initialState)).toBeUndefined();
    expect(packConversionStateToInput(initialState)).toEqual({
      components: [
        { unitProductId: "prod-cola", unitsPerPack: 2 },
        { costWeight: 2, unitProductId: "prod-manzana", unitsPerPack: 2 },
        { unitProductId: "prod-naranja", unitsPerPack: 2 },
      ],
      enabled: true,
      label: "Refrescos sabores",
      mode: "assorted",
      totalUnits: 6,
    });
  });

  it("de surtido a 1 a 1: al cambiar de modo hay que elegir el producto unidad", async () => {
    installProductsApi();
    const { lastState, user } = renderFields({
      initialState: createDefaultPackConversionFormState(assortedPack),
      packConversion: assortedPack,
    });

    await user.selectOptions(screen.getByLabelText("Modo de vínculo"), "link_existing");

    expect(screen.getByRole("combobox", { name: /Producto unidad/ })).toHaveValue("");
    expect(packConversionStateToInput(lastState())).toEqual({
      enabled: true,
      mode: "link_existing",
      unitProductId: undefined,
      unitsPerPack: 6,
    });
  });

  it("de 1 a 1 a surtido: la unidad vinculada ya es el primer componente", async () => {
    installProductsApi();
    const singlePack: ProductPackConversionSummary = {
      id: "ppc-cola",
      linkedProduct,
      role: "pack",
      unitsPerPack: 6,
    };
    const { lastState, user } = renderFields({
      initialState: createDefaultPackConversionFormState(singlePack),
      packConversion: singlePack,
    });

    await user.selectOptions(screen.getByLabelText("Modo de vínculo"), "assorted");

    expect(productField(1)).toHaveValue("Cola");
    expect(unitsField(1)).toHaveValue("6");
    expect(productField(2)).toHaveValue("");
    expect(lastState().components[0]).toMatchObject({ unitProductId: "prod-cola" });
  });

  it("desactivar el vínculo de un surtido envía `enabled: false`, como hoy", async () => {
    installProductsApi();
    const { lastState, user } = renderFields({
      initialState: createDefaultPackConversionFormState(assortedPack),
      packConversion: assortedPack,
    });

    await user.click(screen.getByRole("checkbox", { name: "Se puede vender por unidad" }));

    expect(packConversionStateToInput(lastState())).toEqual({ enabled: false });
    expect(screen.queryByLabelText("Nombre del surtido")).not.toBeInTheDocument();
  });

  it("producto unidad de varios empaques: el bloque de solo lectura los lista todos", () => {
    installProductsApi();
    renderFields({
      initialState: createDefaultPackConversionFormState(),
      isUnitRole: true,
      packConversion: {
        id: "ppc-cola",
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
        unitsPerPack: 6,
      },
    });

    const items = screen.getAllByRole("listitem").map((item) => item.textContent);

    expect(items).toEqual(["Caja Cola x6 (6 und/caja)", "Refrescos sabores x6 (2 und/caja)"]);
    expect(screen.getByText(/2 empaques/)).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("getAssortedPackErrors (PRO-13)", () => {
  it("la suma distinta del total declarado bloquea con su mensaje", () => {
    expect(
      getAssortedPackErrors(
        assortedState({ components: [filledRow("a", "3"), filledRow("b", "2")] }),
      ),
    ).toEqual({
      components: undefined,
      rows: {},
      total: "Los productos suman 5 unidades y el empaque declara 6.",
    });
  });

  it("un producto repetido avisa en la segunda fila", () => {
    const first = filledRow("a", "3");
    const second = filledRow("a", "3");

    expect(getAssortedPackErrors(assortedState({ components: [first, second] }))?.rows).toEqual({
      [second.key]: { product: "Este producto ya está en otra fila." },
    });
  });

  it("menos de 2 productos avisa aunque la suma cuadre", () => {
    expect(
      getAssortedPackErrors(assortedState({ components: [filledRow("a", "6")] })),
    ).toMatchObject({ components: "Un empaque surtido lleva al menos 2 productos." });
  });

  it.each(["", "0", "1.5"])("unidades «%s» no valen", (unitsPerPack) => {
    const row = filledRow("a", unitsPerPack);
    const errors = getAssortedPackErrors(
      assortedState({ components: [row, filledRow("b", "6")] }),
    );

    expect(errors?.rows[row.key]?.units).toEqual(expect.any(String));
    // Con una fila a medias la suma todavía no se juzga.
    expect(errors?.total).toBeUndefined();
  });

  it("getPackComponentsSumText dice cuánto falta o sobra", () => {
    const components = [filledRow("a", "3"), filledRow("b", "2")];

    expect(getPackComponentsSumText({ components, unitsPerPack: "6" })).toEqual({
      matches: false,
      text: "Suma: 5 de 6 unidades — faltan 1",
    });
    expect(getPackComponentsSumText({ components, unitsPerPack: "5" })).toEqual({
      matches: true,
      text: "✓ 5 de 5 unidades",
    });
  });

  it("addProductToPackComponents ocupa la primera fila vacía o añade una", () => {
    const filled = filledRow("a", "3");
    const empty = createPackComponentRow({ unitsPerPack: "2" });
    const product = { id: "prod-new", isActive: true, name: "Uva" };

    const intoEmpty = addProductToPackComponents([filled, empty], product);

    expect(intoEmpty.rowKey).toBe(empty.key);
    expect(intoEmpty.components).toEqual([
      filled,
      { ...empty, unitName: "Uva", unitProductId: "prod-new" },
    ]);

    const appended = addProductToPackComponents([filled], product);

    expect(appended.components).toHaveLength(2);
    expect(appended.components[1]).toMatchObject({ key: appended.rowKey, unitProductId: "prod-new" });
  });
});
