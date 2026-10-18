import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { EntityFetcherParams, ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import { InvoiceReviewProductSearch } from "./InvoiceReviewProductSearch";

function product(id: string, label: string): ProductEntityOption {
  return {
    barcode: null,
    categoryId: "cat",
    currentCostRef: 1,
    currentStock: 4,
    id,
    isActive: true,
    label,
    salePriceRef: 2,
    sku: `SKU-${id}`,
  };
}

/** Catálogo con búsqueda por subcadena, como `/api/products?search=`. */
const CATALOG = [
  product("p1", "Refresco Coca Cola 2 Lt"),
  product("p2", "Refresco Pepsi 2 Lt"),
  product("p3", "Refresco Frescolita 1,5 Lt"),
  product("p4", "Refresco Chinotto 2 Lt"),
  product("p5", "Refresco Golden Manzana 2 Lt"),
  product("p6", "Refresco Hit Naranja 2 Lt"),
  product("p7", "Refresco Uva 1 Lt"),
  product("p8", "Refresco 7Up 2 Lt"),
  product("g1", "Glup Sabores 2 Lt"),
  product("g2", "Glup Cola 1 Lt"),
  product("g3", "Glup Naranja 400 ml"),
  product("h1", "Harina PAN 1 kg"),
];

function catalogFetcher() {
  return jest.fn(async ({ limit, query }: EntityFetcherParams<"product">) => {
    const needle = query.trim().toLowerCase();
    return CATALOG.filter((option) => option.label.toLowerCase().includes(needle)).slice(0, limit);
  });
}

function renderSearch(initialQuery: string, fetcher = catalogFetcher()) {
  render(
    <InvoiceReviewProductSearch
      candidates={[]}
      fetcher={fetcher}
      initialQuery={initialQuery}
      label="Producto de la línea 1"
      onPick={jest.fn()}
    />,
  );
  return fetcher;
}

describe("InvoiceReviewProductSearch", () => {
  it("REP-02: con el texto leído sin coincidencia literal muestra arriba los 3 más parecidos", async () => {
    renderSearch("REFRESCO GLUP SABOR 2LT");

    const input = await screen.findByRole("combobox", { name: "Producto de la línea 1" });
    expect(input).toHaveValue("REFRESCO GLUP SABOR 2LT");

    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("Glup Sabores 2 Lt");
    expect(options.slice(0, 3).map((option) => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Glup Cola 1 Lt"), expect.stringContaining("Glup Naranja 400 ml")]),
    );
  });

  it("si el usuario edita el texto, la búsqueda es la normal (sin tokens)", async () => {
    const user = userEvent.setup();
    const fetcher = renderSearch("REFRESCO GLUP SABOR 2LT");

    const input = await screen.findByRole("combobox", { name: "Producto de la línea 1" });
    await screen.findAllByRole("option");
    const callsBeforeEdit = fetcher.mock.calls.length;

    await user.clear(input);
    await user.type(input, "pepsi");

    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("Refresco Pepsi 2 Lt");
    });
    const queriesAfterEdit = fetcher.mock.calls.slice(callsBeforeEdit).map(([params]) => params.query);
    expect(queriesAfterEdit).toContain("pepsi");
    expect(queriesAfterEdit.every((query) => "pepsi".startsWith(query))).toBe(true);
  });

  it("si el texto leído ya trae resultados no busca por tokens", async () => {
    const fetcher = renderSearch("Glup");

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(3);
    expect(fetcher.mock.calls.map(([params]) => params.query)).toEqual(["Glup"]);
  });

  it("REP2-03d: candidatos empatados de igual nombre se distinguen por SKU, como en los chips", async () => {
    render(
      <InvoiceReviewProductSearch
        candidates={[
          { name: "CAOSG Jabon Azul 250g", productId: "j1", reason: "nombre parecido 0,73", score: 0.73, sku: "CAOSG-JA-1" },
          { name: "CAOSG Jabon Azul 250g", productId: "j2", reason: "nombre parecido 0,73", score: 0.73, sku: "CAOSG-JA-2" },
        ]}
        fetcher={catalogFetcher()}
        initialQuery="JABON AZUL 250G"
        label="Producto de la línea 1"
        onPick={jest.fn()}
      />,
    );

    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("CAOSG Jabon Azul 250g");
    expect(options[0]).toHaveTextContent("Sugerido · SKU CAOSG-JA-1 · nombre parecido 0,73 · 0,73");
    expect(options[1]).toHaveTextContent("Sugerido · SKU CAOSG-JA-2 · nombre parecido 0,73 · 0,73");
  });
});
