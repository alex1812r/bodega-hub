import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";
import { listProducts } from "@/modules/products/services/products.mock-server";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  createDefaultPackConversionFormState,
  findUnitProductField,
  getUnitProductError,
  getUnitsPerPackError,
  type PackConversionFormState,
  packConversionStateToInput,
  ProductPackConversionFields,
} from "./ProductPackConversionFields";

const linkedPack: ProductPackConversionSummary = {
  id: "ppc-cigars",
  linkedProduct: {
    currentCostRef: 1.25,
    currentStock: 3,
    id: "prod-cigar-unit",
    name: "Cigarro individual",
    salePriceRef: 2,
    sku: "cig-und-001",
  },
  role: "pack",
  unitsPerPack: 10,
};

const linkExistingState: PackConversionFormState = {
  ...createDefaultPackConversionFormState(),
  enabled: true,
  mode: "link_existing",
};

type FetchResponder = (url: URL) => Promise<Response>;

/** `GET /api/products` respondido por el mock server real de productos. */
function installProductsApi(respond?: FetchResponder) {
  const urls: URL[] = [];

  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");

    urls.push(url);

    return respond
      ? respond(url)
      : Promise.resolve(jsonResponse({ data: listProducts(url.searchParams, DEFAULT_STORE_ID) }));
  }) as unknown as typeof fetch;

  return urls;
}

type HarnessProps = {
  excludeProductId?: string;
  initialState?: PackConversionFormState;
  onPatch?: (patch: Partial<PackConversionFormState>) => void;
  onState?: (state: PackConversionFormState) => void;
  packConversion?: ProductPackConversionSummary;
  showErrors?: boolean;
  unitSearchResetKey?: number;
};

function Harness({
  excludeProductId,
  initialState = linkExistingState,
  onPatch,
  onState,
  packConversion,
  showErrors,
  unitSearchResetKey,
}: HarnessProps) {
  const [state, setState] = useState(initialState);

  return (
    <ProductPackConversionFields
      excludeProductId={excludeProductId}
      onChange={(patch) => {
        const next = { ...state, ...patch };

        onPatch?.(patch);
        onState?.(next);
        setState(next);
      }}
      packConversion={packConversion}
      productName="Caja de prueba"
      showErrors={showErrors}
      state={state}
      unitSearchResetKey={unitSearchResetKey}
    />
  );
}

function renderFields(props: HarnessProps = {}) {
  const onPatch = jest.fn();
  const onState = jest.fn();

  render(<Harness {...props} onPatch={onPatch} onState={onState} />);

  return { onPatch, onState, user: userEvent.setup() };
}

function unitField() {
  return screen.getByRole("combobox", { name: /Producto unidad/ });
}

describe("ProductPackConversionFields: producto unidad", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("no carga ninguna lista de productos al mostrarse: es un buscador, no un select", () => {
    const urls = installProductsApi();

    renderFields();

    expect(unitField().tagName).toBe("INPUT");
    expect(unitField()).toHaveValue("");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Crear producto unidad",
      "Vincular producto existente",
    ]);
    expect(urls).toEqual([]);
  });

  it.each([
    ["nombre", "taladro"],
    ["SKU", "her-tal"],
    ["código de barras", "7501234567"],
  ])("busca por %s en servidor y al elegir deja el mismo estado que el select", async (_, typed) => {
    const urls = installProductsApi();
    const { onPatch, onState, user } = renderFields();

    await user.type(unitField(), typed);
    await user.click(await screen.findByRole("option", { name: /Taladro percutor/ }));

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ unitProductId: "prod-drill" });
    expect(onState).toHaveBeenLastCalledWith({ ...linkExistingState, unitProductId: "prod-drill" });
    expect(packConversionStateToInput(onState.mock.calls[0][0])).toEqual({
      enabled: true,
      mode: "link_existing",
      unitProductId: "prod-drill",
      unitsPerPack: 10,
    });
    expect(unitField()).toHaveValue("Taladro percutor");
    expect(urls.length).toBeGreaterThan(0);
    urls.forEach((url) => {
      expect(url.pathname).toBe("/api/products");
      expect(url.searchParams.get("search")).toBe(typed);
      expect(url.searchParams.get("isActive")).toBe("true");
      expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(9);
    });
    expect(urls.some((url) => url.searchParams.get("packLink") === "none")).toBe(true);
  });

  it("un escaneo con Enter elige la coincidencia exacta de código de barras", async () => {
    installProductsApi();
    const { onPatch, user } = renderFields();

    await user.type(unitField(), "7501234567890{Enter}");

    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ unitProductId: "prod-drill" }));
    expect(unitField()).toHaveValue("Taladro percutor");
  });

  it("no ofrece el propio producto", async () => {
    installProductsApi();
    const { onPatch, user } = renderFields({ excludeProductId: "prod-drill" });

    await user.type(unitField(), "taladro");

    expect(await screen.findByText("Sin resultados para “taladro”")).toBeVisible();
    expect(screen.queryByRole("option", { name: /Taladro percutor/ })).not.toBeInTheDocument();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("no ofrece productos inactivos", async () => {
    installProductsApi();
    const { user } = renderFields();

    await user.type(unitField(), "pintura");

    expect(await screen.findByRole("option", { name: /Pintura blanca galon/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /Pintura latex azul/ })).not.toBeInTheDocument();
  });

  it("los productos con vínculo de empaque salen deshabilitados con su motivo y no se eligen", async () => {
    installProductsApi();
    const { onPatch, user } = renderFields();

    await user.type(unitField(), "cig");

    const pack = await screen.findByRole("option", { name: /Caja cigarros/ });
    const unit = screen.getByRole("option", { name: /Cigarro individual/ });

    [pack, unit].forEach((option) => {
      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(within(option).getByText("Ya tiene un vínculo de empaque.")).toBeVisible();
    });

    await user.click(pack);
    await user.click(unit);
    await user.keyboard("{Enter}");

    expect(onPatch).not.toHaveBeenCalled();
    expect(unitField()).toHaveValue("cig");
  });

  it("un escaneo del código exacto de un producto ya vinculado no lo elige", async () => {
    installProductsApi();
    const { onPatch, user } = renderFields();

    await user.type(unitField(), "cig-und-001{Enter}");

    expect(await screen.findByRole("option", { name: /Cigarro individual/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("los elegibles van antes que los ya vinculados", async () => {
    installProductsApi();
    const { user } = renderFields();

    await user.type(unitField(), "ca");
    await screen.findByRole("option", { name: /Cable THW 12/ });

    const disabledFlags = within(screen.getByRole("listbox", { name: "Producto unidad" }))
      .getAllByRole("option")
      .map((option) => option.getAttribute("aria-disabled") === "true");

    expect(disabledFlags).toContain(true);
    expect(disabledFlags).toEqual([...disabledFlags].sort((a, b) => Number(a) - Number(b)));
  });

  it("en edición muestra la unidad ya vinculada sin pedir la lista de productos", () => {
    const urls = installProductsApi();
    const initialState = createDefaultPackConversionFormState(linkedPack);

    renderFields({
      excludeProductId: "prod-cigar-pack",
      initialState,
      packConversion: linkedPack,
    });

    expect(unitField()).toHaveValue("Cigarro individual");
    expect(urls).toEqual([]);
    expect(packConversionStateToInput(initialState)).toEqual({
      enabled: true,
      mode: "link_existing",
      unitProductId: "prod-cigar-unit",
      unitsPerPack: 10,
    });
  });

  it("en edición, tras limpiar, la unidad de este empaque se puede volver a elegir", async () => {
    installProductsApi();
    const { onPatch, onState, user } = renderFields({
      excludeProductId: "prod-cigar-pack",
      initialState: createDefaultPackConversionFormState(linkedPack),
      packConversion: linkedPack,
    });

    await user.click(screen.getByRole("button", { name: "Limpiar Producto unidad" }));

    expect(onPatch).toHaveBeenLastCalledWith({ unitProductId: "" });
    expect(unitField()).toHaveValue("");
    expect(packConversionStateToInput(onState.mock.calls[0][0])).toEqual({
      enabled: true,
      mode: "link_existing",
      unitProductId: undefined,
      unitsPerPack: 10,
    });

    await user.type(unitField(), "cig");

    const unit = await screen.findByRole("option", { name: /Cigarro individual/ });

    expect(unit).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("option", { name: /Caja cigarros/ })).not.toBeInTheDocument();

    await user.click(unit);

    expect(onPatch).toHaveBeenLastCalledWith({ unitProductId: "prod-cigar-unit" });
    expect(unitField()).toHaveValue("Cigarro individual");
  });

  it("muestra «Buscando...» mientras el servidor no responde", async () => {
    installProductsApi(() => new Promise<Response>(() => undefined));
    const { user } = renderFields();

    await user.type(unitField(), "taladro");

    expect(await screen.findByText("Buscando...")).toBeVisible();
  });

  it("muestra el mensaje del servidor si la búsqueda falla y permite reintentar", async () => {
    let fails = true;

    installProductsApi((url) =>
      Promise.resolve(
        fails
          ? jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Fallo simulado" } }, 500)
          : jsonResponse({ data: listProducts(url.searchParams, DEFAULT_STORE_ID) }),
      ),
    );
    const { user } = renderFields();

    await user.type(unitField(), "taladro");

    expect(await screen.findByRole("alert")).toHaveTextContent("Fallo simulado");

    fails = false;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("option", { name: /Taladro percutor/ })).toBeVisible();
  });

  it("getUnitProductError solo avisa con el empaque activo, en modo vincular y sin unidad", () => {
    expect(getUnitProductError(linkExistingState)).toBe("Elige el producto unidad.");
    expect(
      getUnitProductError({ ...linkExistingState, unitProductId: "prod-drill" }),
    ).toBeUndefined();
    expect(getUnitProductError({ ...linkExistingState, mode: "create_unit" })).toBeUndefined();
    expect(getUnitProductError({ ...linkExistingState, enabled: false })).toBeUndefined();
  });

  it("tras intentar enviar sin producto unidad el campo muestra su aviso, y se va al elegir", async () => {
    installProductsApi();
    const { user } = renderFields({ showErrors: true });

    expect(unitField()).toHaveAttribute("aria-invalid", "true");
    expect(unitField()).toHaveAccessibleDescription("Elige el producto unidad.");
    expect(findUnitProductField(document.body)).toBe(unitField());

    await user.type(unitField(), "taladro");
    await user.click(await screen.findByRole("option", { name: /Taladro percutor/ }));

    expect(unitField()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Elige el producto unidad.")).not.toBeInTheDocument();
  });

  it("antes de intentar enviar el campo vacío no avisa", () => {
    installProductsApi();
    renderFields();

    expect(unitField()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Elige el producto unidad.")).not.toBeInTheDocument();
  });

  it("no ofrece «Recientes»: una unidad elegida antes puede tener ya un vínculo", async () => {
    installProductsApi();
    const { user } = renderFields();

    await user.type(unitField(), "taladro");
    await user.click(await screen.findByRole("option", { name: /Taladro percutor/ }));
    await user.click(screen.getByRole("button", { name: "Limpiar Producto unidad" }));
    await user.click(unitField());

    expect(unitField()).toHaveFocus();
    expect(screen.queryByText("Recientes")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Taladro percutor/ })).not.toBeInTheDocument();
    expect(
      Object.keys(window.localStorage).filter((key) => key.includes("entity-autocomplete:recents")),
    ).toEqual([]);
  });

  it("tampoco ofrece los recientes de otros buscadores de producto", async () => {
    installProductsApi();
    window.localStorage.setItem(
      "bodega-hub:entity-autocomplete:recents:product",
      JSON.stringify([
        {
          barcode: null,
          categoryId: "cat-1",
          currentCostRef: 1,
          currentStock: 3,
          id: "prod-cigar-unit",
          isActive: true,
          label: "Cigarro individual",
          salePriceRef: 2,
          sku: "cig-und-001",
        },
      ]),
    );
    const { user } = renderFields();

    await user.click(unitField());

    expect(unitField()).toHaveFocus();
    expect(screen.queryByText("Recientes")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Cigarro individual/ })).not.toBeInTheDocument();
  });

  it("al cambiar unitSearchResetKey la misma búsqueda vuelve a pedirse al servidor", async () => {
    const urls = installProductsApi();
    const user = userEvent.setup();
    const { rerender } = render(<Harness unitSearchResetKey={0} />);

    await user.type(unitField(), "taladro");
    await screen.findByRole("option", { name: /Taladro percutor/ });

    const requestsPerSearch = urls.length;

    // Sin cambio de clave, repetir el texto reutiliza el resultado.
    await user.clear(unitField());
    await user.type(unitField(), "taladro");
    await screen.findByRole("option", { name: /Taladro percutor/ });
    expect(urls.length).toBe(requestsPerSearch);

    rerender(<Harness unitSearchResetKey={1} />);
    await user.type(unitField(), "taladro");
    await screen.findByRole("option", { name: /Taladro percutor/ });

    expect(urls.length).toBe(requestsPerSearch * 2);
  });

  it("los textos del empaque llevan tilde", () => {
    installProductsApi();
    renderFields({ initialState: { ...linkExistingState, mode: "create_unit" } });

    expect(screen.getByLabelText("Modo de vínculo")).toBeVisible();
    expect(screen.getByLabelText("Código de barras unidad")).toBeVisible();
    expect(getUnitsPerPackError("1")).toBe("Indica unidades por empaque (mínimo 2).");
  });

  it("en modo «Crear producto unidad» no hay buscador de producto unidad", () => {
    installProductsApi();

    renderFields({ initialState: { ...linkExistingState, mode: "create_unit" } });

    expect(screen.queryByRole("combobox", { name: /Producto unidad/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nombre unidad")).toBeVisible();
  });
});
