import type { ContactMock, ProductMock } from "@/shared/mocks/erp-data";

import {
  fetchContactEntityOptions,
  fetchProductEntityOptions,
  toContactTypeParam,
} from "./entityFetchers";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function page<T>(items: T[]) {
  return jsonResponse({ data: { items, limit: 10, skip: 0, total: items.length } });
}

function apiProduct(index: number, overrides: Partial<ProductMock> = {}): ProductMock {
  return {
    barcode: `759${index}`,
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock: 4,
    id: `p-${index}`,
    isActive: true,
    minStock: 0,
    name: `Producto ${index}`,
    salePriceRef: 2.5,
    sku: `SKU-${index}`,
    ...overrides,
  };
}

function apiContact(index: number): ContactMock {
  return {
    address: "",
    email: "",
    id: `c-${index}`,
    isActive: true,
    name: `Contacto ${index}`,
    phone: "0414-0000000",
    taxId: "J-12345678",
    type: "proveedor",
  };
}

describe("fetchers por defecto de EntityAutocomplete", () => {
  const fetchMock = jest.fn();
  const signal = new AbortController().signal;

  function requestedUrl(call = 0) {
    return new URL(fetchMock.mock.calls[call][0] as string, "http://localhost");
  }

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("busca productos en servidor con limit=8, sin descargar el catálogo", async () => {
    fetchMock.mockResolvedValueOnce(page([apiProduct(1, { barcode: undefined })]));

    const options = await fetchProductEntityOptions({
      exact: false,
      filters: { active: true, categoryId: "cat-1" },
      limit: 8,
      query: "arroz",
      signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl().pathname).toBe("/api/products");
    expect(Object.fromEntries(requestedUrl().searchParams)).toEqual({
      categoryId: "cat-1",
      isActive: "true",
      limit: "8",
      search: "arroz",
      skip: "0",
    });
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ signal }));
    expect(options).toEqual([
      {
        barcode: null,
        categoryId: "cat-1",
        currentCostRef: 1,
        currentStock: 4,
        id: "p-1",
        isActive: true,
        label: "Producto 1",
        salePriceRef: 2.5,
        sku: "SKU-1",
      },
    ]);
  });

  it("pide margen para los excluidos sin pasar del tope del BFF", async () => {
    fetchMock.mockResolvedValue(page([]));

    await fetchProductEntityOptions({
      exact: false,
      filters: { excludeIds: ["a", "b", "c"] },
      limit: 8,
      query: "arroz",
      signal,
    });
    await fetchProductEntityOptions({
      exact: false,
      filters: { excludeIds: Array.from({ length: 500 }, (_, index) => `p-${index}`) },
      limit: 8,
      query: "arroz",
      signal,
    });

    expect(requestedUrl(0).searchParams.get("limit")).toBe("11");
    expect(requestedUrl(1).searchParams.get("limit")).toBe("100");
  });

  it("en búsqueda exacta consulta además código de barras y SKU exactos y los pone primero sin duplicar", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const params = new URL(url, "http://localhost").searchParams;

      if (params.has("barcode")) {
        return page([apiProduct(2)]);
      }

      return params.has("sku") ? page([]) : page([apiProduct(1), apiProduct(2)]);
    });

    const options = await fetchProductEntityOptions({
      exact: true,
      filters: {},
      limit: 8,
      query: "7592",
      signal,
    });

    const queries = fetchMock.mock.calls.map(([url]) =>
      Object.fromEntries(new URL(url as string, "http://localhost").searchParams),
    );

    expect(queries).toEqual(
      expect.arrayContaining([
        { barcode: "7592", limit: "8", skip: "0" },
        { limit: "8", sku: "7592", skip: "0" },
        { limit: "8", search: "7592", skip: "0" },
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(options.map((option) => option.id)).toEqual(["p-2", "p-1"]);
  });

  it("trae el SKU exacto aunque la búsqueda parcial llene la página sin él", async () => {
    const partialMatches = Array.from({ length: 10 }, (_, index) => apiProduct(index + 1));
    const exactBySku = apiProduct(99, { sku: "arr-1" });

    fetchMock.mockImplementation(async (url: string) => {
      const params = new URL(url, "http://localhost").searchParams;

      if (params.has("barcode")) {
        return page([]);
      }

      return params.has("sku") ? page([exactBySku]) : page(partialMatches);
    });

    const options = await fetchProductEntityOptions({
      exact: true,
      filters: { active: true, categoryId: "cat-1" },
      limit: 8,
      query: "ARR-1",
      signal,
    });

    const skuCall = fetchMock.mock.calls
      .map(([url]) => Object.fromEntries(new URL(url as string, "http://localhost").searchParams))
      .find((params) => "sku" in params);

    expect(skuCall).toEqual({
      categoryId: "cat-1",
      isActive: "true",
      limit: "8",
      sku: "ARR-1",
      skip: "0",
    });
    expect(options[0]).toEqual(expect.objectContaining({ id: "p-99", sku: "arr-1" }));
    expect(options).toHaveLength(11);
  });

  it("no consulta barcode ni sku fuera del Enter", async () => {
    fetchMock.mockResolvedValue(page([]));

    await fetchProductEntityOptions({ exact: false, filters: {}, limit: 8, query: "arr", signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl().searchParams.has("sku")).toBe(false);
    expect(requestedUrl().searchParams.has("barcode")).toBe(false);
  });

  it("pide al servidor el estado de contacto del filtro active", async () => {
    fetchMock.mockResolvedValueOnce(page([{ ...apiContact(1), isActive: false }]));

    const options = await fetchContactEntityOptions({
      exact: false,
      filters: { active: false },
      limit: 8,
      query: "lago",
      signal,
    });

    expect(requestedUrl().searchParams.get("isActive")).toBe("false");
    expect(options).toEqual([expect.objectContaining({ id: "c-1", isActive: false })]);
  });

  it("busca contactos con el tipo que entiende el BFF", async () => {
    fetchMock.mockResolvedValueOnce(page([apiContact(1)]));

    const options = await fetchContactEntityOptions({
      exact: false,
      filters: { active: true, type: ["proveedor", "ambos"] },
      limit: 8,
      query: "J-123",
      signal,
    });

    expect(requestedUrl().pathname).toBe("/api/contacts");
    expect(Object.fromEntries(requestedUrl().searchParams)).toEqual({
      isActive: "true",
      limit: "8",
      search: "J-123",
      skip: "0",
      type: "proveedor",
    });
    expect(options).toEqual([
      {
        id: "c-1",
        isActive: true,
        label: "Contacto 1",
        phone: "0414-0000000",
        taxId: "J-12345678",
        type: "proveedor",
      },
    ]);
  });

  it("propaga el 403 del BFF con su mensaje", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "FORBIDDEN", message: "No tienes permiso para ver proveedores." } },
        403,
      ),
    );

    await expect(
      fetchContactEntityOptions({
        exact: false,
        filters: { type: ["proveedor"] },
        limit: 8,
        query: "ab",
        signal,
      }),
    ).rejects.toMatchObject({ message: "No tienes permiso para ver proveedores.", status: 403 });
  });

  it.each([
    [undefined, undefined],
    [[], undefined],
    [["proveedor", "ambos"], "proveedor"],
    [["proveedor"], "proveedor"],
    [["cliente", "ambos"], "cliente"],
    [["ambos"], "ambos"],
    [["cliente", "proveedor"], undefined],
  ] as const)("traduce el filtro de tipo %j a type=%s", (types, expected) => {
    expect(toContactTypeParam(types ? [...types] : undefined)).toBe(expected);
  });
});
