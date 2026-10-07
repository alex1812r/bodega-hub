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
};

function Harness({
  excludeProductId,
  initialState = linkExistingState,
  onPatch,
  onState,
  packConversion,
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
      state={state}
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

  it("en modo «Crear producto unidad» no hay buscador de producto unidad", () => {
    installProductsApi();

    renderFields({ initialState: { ...linkExistingState, mode: "create_unit" } });

    expect(screen.queryByRole("combobox", { name: /Producto unidad/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nombre unidad")).toBeVisible();
  });
});
