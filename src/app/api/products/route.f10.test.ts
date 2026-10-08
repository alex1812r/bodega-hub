/**
 * @jest-environment node
 *
 * PRO-F10 · medios de CAOS vistos desde las rutas:
 * - M6: un cuerpo que no es JSON responde 400 (antes 500) en las rutas de
 *   productos, categorías y ajustes; un NUL en un texto no llega a la base; una
 *   búsqueda de 10 000 caracteres se recorta.
 * - M3/M4: categoría vacía o de otra tienda → 400 con mensaje.
 * - M5: el PATCH con `salePriceRef` deja entrada en el historial.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

jest.mock("../../../modules/contacts/services/supplierProducts.server", () => ({
  ...jest.requireActual("../../../modules/contacts/services/supplierProducts.server"),
  listPreferredSuppliersByProduct: jest.fn(async () => new Map()),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { revalidateProductImportRows } from "@/modules/products/products-import/services/validateProductImportRows";
import { mockCategories } from "@/shared/mocks/erp-data";

import { PATCH as patchCategory } from "../categories/[id]/route";
import { POST as postCategory } from "../categories/route";
import { PATCH as patchSettings } from "../settings/route";
import { POST as postBarcode } from "./[id]/barcode/route";
import { POST as postKeepPrice } from "./[id]/keep-price/route";
import { GET as getPriceHistory } from "./[id]/price-history/route";
import { POST as postPrice } from "./[id]/price/route";
import { PATCH as patchProduct } from "./[id]/route";
import { PUT as putSuppliers } from "./[id]/suppliers/route";
import { POST as postReprice } from "./price-review/reprice/route";
import { GET as getProducts, POST as postProduct } from "./route";

const INVALID_JSON_MESSAGE = "El cuerpo de la solicitud no es un JSON valido.";
const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const NUL = "\u0000";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function request(url: string, method: string, body?: string) {
  return new Request(`http://localhost${url}`, {
    body,
    headers: { "content-type": "application/json" },
    method,
  });
}

function json(url: string, method: string, body: unknown) {
  return request(url, method, JSON.stringify(body));
}

type Handler = (body: string | undefined) => Promise<Response>;

const routesWithRequiredBody: Array<[string, Handler]> = [
  ["POST /api/products", (body) => postProduct(request("/api/products", "POST", body))],
  [
    "PATCH /api/products/[id]",
    (body) => patchProduct(request("/api/products/prod-drill", "PATCH", body), context("prod-drill")),
  ],
  [
    "POST /api/products/[id]/price",
    (body) => postPrice(request("/api/products/prod-drill/price", "POST", body), context("prod-drill")),
  ],
  [
    "POST /api/products/[id]/barcode",
    (body) =>
      postBarcode(request("/api/products/prod-drill/barcode", "POST", body), context("prod-drill")),
  ],
  [
    "PUT /api/products/[id]/suppliers",
    (body) =>
      putSuppliers(request("/api/products/prod-drill/suppliers", "PUT", body), context("prod-drill")),
  ],
  [
    "POST /api/products/price-review/reprice",
    (body) => postReprice(request("/api/products/price-review/reprice", "POST", body)),
  ],
  ["POST /api/categories", (body) => postCategory(request("/api/categories", "POST", body))],
  [
    "PATCH /api/categories/[id]",
    (body) => patchCategory(request("/api/categories/cat-tools", "PATCH", body), context("cat-tools")),
  ],
  ["PATCH /api/settings", (body) => patchSettings(request("/api/settings", "PATCH", body))],
];

describe("PRO-F10 · rutas de productos, categorías y ajustes", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  describe("M6 · cuerpo que no es JSON", () => {
    it.each(routesWithRequiredBody)("%s responde 400 con un cuerpo malformado", async (_name, call) => {
      const response = await call("{");
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toEqual({ code: "BAD_REQUEST", message: INVALID_JSON_MESSAGE });
    });

    it.each(routesWithRequiredBody)("%s responde 400 con el cuerpo vacío", async (_name, call) => {
      const response = await call(undefined);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toEqual({ code: "BAD_REQUEST", message: INVALID_JSON_MESSAGE });
    });

    it("POST /api/products/[id]/keep-price: malformado → 400; vacío sigue valiendo (sin motivo)", async () => {
      const malformed = await postKeepPrice(
        request("/api/products/prod-drill/keep-price", "POST", "{"),
        context("prod-drill"),
      );

      expect(malformed.status).toBe(400);
      expect((await malformed.json()).error).toEqual({
        code: "BAD_REQUEST",
        message: INVALID_JSON_MESSAGE,
      });

      const empty = await postKeepPrice(
        request("/api/products/prod-drill/keep-price", "POST"),
        context("prod-drill"),
      );

      expect(empty.status).toBe(200);
    });
  });

  describe("M6 · NUL en un texto", () => {
    it("POST /api/products guarda el nombre, el SKU y el código sin el NUL", async () => {
      const response = await postProduct(
        json("/api/products", "POST", {
          barcode: `759100${NUL}0011`,
          categoryId: "cat-tools",
          name: `F10 ruta${NUL} NUL`,
          salePriceRef: 5,
          sku: `f10-ruta-${NUL}nul`,
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data).toMatchObject({
        barcode: "7591000011",
        name: "F10 ruta NUL",
        sku: "f10-ruta-nul",
      });
    });

    it("POST /api/categories guarda el nombre sin el NUL; un nombre que queda vacío → 400", async () => {
      const created = await postCategory(
        json("/api/categories", "POST", { name: `F10 cate${NUL}goría` }),
      );

      expect(created.status).toBe(201);
      expect((await created.json()).data.name).toBe("F10 categoría");

      const empty = await postCategory(json("/api/categories", "POST", { name: NUL }));

      expect(empty.status).toBe(400);
    });

    it("POST /api/products/[id]/price guarda el motivo sin el NUL", async () => {
      const response = await postPrice(
        json("/api/products/prod-hammer/price", "POST", { reason: `Sub${NUL}ida`, salePriceRef: 77 }),
        context("prod-hammer"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.history.reason).toBe("Subida");
    });
  });

  describe("M6 · búsqueda de 10 000 caracteres", () => {
    it("GET /api/products responde 200 y filtra con el término recortado a 100", async () => {
      process.env.API_DATA_SOURCE = "supabase";
      const chain: Record<string, jest.Mock> = {
        eq: jest.fn(),
        or: jest.fn(),
        order: jest.fn(),
        range: jest.fn().mockResolvedValue({ count: 0, data: [], error: null }),
        select: jest.fn(),
      };
      chain.eq.mockReturnValue(chain);
      chain.or.mockReturnValue(chain);
      chain.order.mockReturnValue(chain);
      chain.select.mockReturnValue(chain);
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: jest.fn(() => chain) });

      const response = await getProducts(
        new Request(`http://localhost/api/products?search=${"a".repeat(10_000)}`),
      );

      expect(response.status).toBe(200);
      expect(chain.or).toHaveBeenCalledWith(
        ["name", "sku", "barcode"].map((column) => `${column}.ilike.%${"a".repeat(100)}%`).join(","),
      );
    });

    it("GET /api/products encuentra un producto con paréntesis y coma en el nombre (mock)", async () => {
      await postProduct(
        json("/api/products", "POST", {
          categoryId: "cat-tools",
          name: "F10 Harina (1 kg) x, extra",
          salePriceRef: 5,
          sku: "f10-harina-parentesis",
        }),
      );

      const response = await getProducts(
        new Request(
          `http://localhost/api/products?search=${encodeURIComponent("Harina (1 kg) x, extra")}`,
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items.map((item: { sku: string }) => item.sku)).toEqual([
        "f10-harina-parentesis",
      ]);
    });
  });

  describe("M3/M4 · categoría del producto", () => {
    const foreignCategory = {
      id: "cat-f10-ruta-ajena",
      isActive: true,
      name: "General ajena",
      storeId: OTHER_STORE_ID,
      taxRate: 16,
    };

    beforeAll(() => {
      mockCategories.push(foreignCategory);
    });

    afterAll(() => {
      mockCategories.splice(mockCategories.indexOf(foreignCategory), 1);
    });

    it.each([
      ["vacía", "", "El producto necesita una categoría."],
      ["de otra tienda", foreignCategory.id, "La categoría no existe o no pertenece a esta tienda."],
      ["inexistente", "cat-no-existe", "La categoría no existe o no pertenece a esta tienda."],
    ])("POST /api/products con categoría %s → 400 con su mensaje", async (_case, categoryId, message) => {
      const response = await postProduct(
        json("/api/products", "POST", { categoryId, name: "F10 sin categoría", salePriceRef: 5 }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toEqual({ code: "BAD_REQUEST", message });
    });

    it.each([
      ["vacía", "", "El producto necesita una categoría."],
      ["de otra tienda", foreignCategory.id, "La categoría no existe o no pertenece a esta tienda."],
    ])("PATCH /api/products/[id] con categoría %s → 400 y la categoría no cambia", async (_case, categoryId, message) => {
      const response = await patchProduct(
        json("/api/products/prod-drill", "PATCH", { categoryId }),
        context("prod-drill"),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toEqual({ code: "BAD_REQUEST", message });
    });
  });

  describe("M3 · la importación Excel sigue entrando por POST /api/products", () => {
    // La importación usa este mismo endpoint con el mismo cuerpo que un alta
    // manual y admite filas sin categoría (`resolveCategoryIdByName` devuelve
    // vacío): por eso el BFF no exige `categoryId` cuando no viene.
    it("una fila con categoría y otra sin categoría se validan y se crean", async () => {
      const rows = revalidateProductImportRows(
        [
          { categoria: "Herramientas", nombre: "F10 import con", precio_ref: 3, rowIndex: 2, sku: "f10-imp-con" },
          { nombre: "F10 import sin", precio_ref: 4, rowIndex: 3, sku: "f10-imp-sin" },
        ],
        {
          categories: mockCategories.filter((category) => category.isActive && !category.storeId),
          existingSkus: new Set(),
        },
      );

      expect(rows.map((row) => row.status)).toEqual(["valid", "valid"]);
      expect(rows.map((row) => row.input?.categoryId)).toEqual(["cat-tools", undefined]);

      for (const row of rows) {
        const response = await postProduct(json("/api/products", "POST", row.input));

        expect(response.status).toBe(201);
        expect((await response.json()).data.sku).toBe(row.sku);
      }
    });
  });

  describe("M5 · precio por PATCH", () => {
    it("PATCH /api/products/[id] con salePriceRef deja la entrada de historial 'Edición del producto'", async () => {
      const response = await patchProduct(
        json("/api/products/prod-drill", "PATCH", { salePriceRef: 98 }),
        context("prod-drill"),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).data.salePriceRef).toBe(98);

      const history = await getPriceHistory(
        new Request("http://localhost/api/products/prod-drill/price-history?limit=1"),
        context("prod-drill"),
      );

      expect((await history.json()).data.items[0]).toMatchObject({
        reason: "Edición del producto",
        salePriceRef: 98,
      });
    });
  });
});
