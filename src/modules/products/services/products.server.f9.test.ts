/**
 * @jest-environment node
 */
/**
 * PRO-F9 · servicio real de productos.
 *
 * ALTA-2: reintentar un alta cuya respuesta se perdió creaba un segundo producto
 * con su `inventario_inicial` (2 productos y 18 u por 9). Con `clientRequestId`
 * el reintento devuelve el producto ya creado y el stock inicial viaja a
 * `adjust_stock` con una clave derivada.
 *
 * ALTA-1 (precio fijo): con `expectedCostRef` el cambio de precio pasa por
 * `update_product_price_checked`; sin él, por la RPC de siempre.
 *
 * La base de mentira modela lo que el parche 20261009f garantiza (probado contra
 * Postgres en `scripts/stock-lab/regression/price-race.test.ts`): el índice único
 * `products_store_client_request_unique` y la idempotencia por clave de `adjust_stock`.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { PRODUCT_CREATE_REQUEST_REUSED_MESSAGE } from "./productSchemas";
import { createProduct, deriveInitialStockRequestId, updateProductPrice } from "./products.server";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

const KEY = "11111111-1111-4111-8111-111111111111";
const OTHER_KEY = "22222222-2222-4222-8222-222222222222";
const INDEX = "products_store_client_request_unique";

function createFakeDatabase() {
  const products: Row[] = [];
  const movements: Row[] = [];
  const stockKeys = new Map<string, Row>();
  const log = { deletes: 0, inserts: [] as Row[], rpcs: [] as { args: Row; name: string }[] };
  const hooks: { beforeInsert: (() => void) | null; rpcCrash: Error | null } = {
    beforeInsert: null,
    rpcCrash: null,
  };

  function insertProduct(row: Row): Result {
    if (
      row.client_request_id &&
      products.some(
        (product) =>
          product.store_id === row.store_id && product.client_request_id === row.client_request_id,
      )
    ) {
      return {
        data: null,
        error: {
          code: "23505",
          details: "Key (store_id, client_request_id) already exists.",
          message: `duplicate key value violates unique constraint "${INDEX}"`,
        },
      };
    }

    if (products.some((product) => product.store_id === row.store_id && product.sku === row.sku)) {
      return {
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "products_store_sku_unique"',
        },
      };
    }

    const created = { id: `prod-${products.length + 1}`, is_active: true, ...row };
    products.push(created);

    return { data: created, error: null };
  }

  function from(table: string) {
    const filters: Row = {};
    let pending: Result | null = null;
    let isDelete = false;

    const matching = () =>
      table === "products"
        ? products.filter((product) =>
            Object.entries(filters).every(([column, value]) => product[column] === value),
          )
        : [];

    const settle = (): Result => {
      if (pending) {
        return pending;
      }

      if (isDelete) {
        const removed = matching();
        for (const product of removed) products.splice(products.indexOf(product), 1);
        log.deletes += removed.length;

        return { data: removed, error: null };
      }

      return { data: matching(), error: null };
    };

    const one = async (): Promise<Result> => {
      const result = settle();

      return Array.isArray(result.data) ? { data: result.data[0] ?? null, error: null } : result;
    };

    const chain = {
      delete: () => {
        isDelete = true;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      in: () => chain,
      insert: (payload: Row) => {
        hooks.beforeInsert?.();
        hooks.beforeInsert = null;
        log.inserts.push({ ...payload });
        pending = insertProduct({ ...payload });
        return chain;
      },
      is: () => chain,
      limit: () => chain,
      maybeSingle: one,
      or: () => chain,
      order: () => chain,
      select: () => chain,
      single: one,
      then: (resolve: (value: Result) => unknown) => Promise.resolve(settle()).then(resolve),
    };

    return chain;
  }

  async function rpc(name: string, args: Row): Promise<Result> {
    log.rpcs.push({ args, name });

    if (hooks.rpcCrash) {
      const crash = hooks.rpcCrash;
      hooks.rpcCrash = null;
      throw crash;
    }

    if (name !== "adjust_stock") {
      return { data: products.find((product) => product.id === args.p_product_id) ?? null, error: null };
    }

    const key = typeof args.p_client_request_id === "string" ? args.p_client_request_id : null;
    const replay = key ? stockKeys.get(key) : undefined;

    if (replay) {
      return { data: replay, error: null };
    }

    const movement = {
      id: `mov-${movements.length + 1}`,
      product_id: args.p_product_id,
      quantity_delta: args.p_quantity_delta,
      type: args.p_type,
    };
    movements.push(movement);
    if (key) stockKeys.set(key, movement);

    return { data: movement, error: null };
  }

  return { client: { from, rpc }, hooks, insertProduct, log, movements, products };
}

function useDatabase() {
  const database = createFakeDatabase();

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(database.client);
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: { store_id: DEFAULT_STORE_ID }, error: null }),
        })),
      })),
    })),
  });

  return database;
}

const harina = { currentCostRef: 3, currentStock: 9, name: "Harina PAN", salePriceRef: 5 };

function totals(database: ReturnType<typeof createFakeDatabase>) {
  return {
    inventarioInicial: database.movements.filter((movement) => movement.type === "inventario_inicial").length,
    productos: database.products.length,
    unidades: database.movements.reduce((sum, movement) => sum + Number(movement.quantity_delta), 0),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("createProduct · clave de idempotencia del alta (PRO-F9, ALTA-2)", () => {
  it("respuesta perdida y reintento con la misma clave: 1 producto, 1 inventario_inicial de 9 y el mismo producto de vuelta", async () => {
    const database = useDatabase();

    const first = await createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);
    // El cliente no recibió la respuesta: vuelve a enviar lo mismo.
    const retry = await createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);

    expect(totals(database)).toEqual({ inventarioInicial: 1, productos: 1, unidades: 9 });
    expect(retry.id).toBe(first.id);
    // El reintento no vuelve a insertar ni borra nada.
    expect(database.log.inserts).toHaveLength(1);
    expect(database.log.deletes).toBe(0);
  });

  it("sin clave (importación, clientes anteriores) cada envío es un alta, y ni la fila ni el ajuste llevan clave", async () => {
    const database = useDatabase();

    await createProduct(harina, DEFAULT_STORE_ID);
    await createProduct(harina, DEFAULT_STORE_ID);

    expect(totals(database)).toEqual({ inventarioInicial: 2, productos: 2, unidades: 18 });
    expect(database.log.inserts[0]).not.toHaveProperty("client_request_id");
    expect(database.log.inserts[0]).not.toHaveProperty("client_request_hash");
    expect(database.log.rpcs[0]).toEqual({
      args: {
        p_product_id: "prod-1",
        p_quantity_delta: 9,
        p_reason: "Inventario inicial al crear el producto",
        p_type: "inventario_inicial",
      },
      name: "adjust_stock",
    });
  });

  it("guarda la clave y la huella en la fila y pide el stock inicial con una clave derivada, estable y distinta de la del producto", async () => {
    const database = useDatabase();

    await createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);

    expect(database.log.inserts[0]).toMatchObject({
      client_request_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      client_request_id: KEY,
      current_stock: 0,
    });
    expect(database.log.rpcs[0]?.args.p_client_request_id).toBe(deriveInitialStockRequestId(KEY));
    expect(deriveInitialStockRequestId(KEY)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveInitialStockRequestId(KEY)).toBe(deriveInitialStockRequestId(KEY.toUpperCase()));
    expect(deriveInitialStockRequestId(KEY)).not.toBe(KEY);
    expect(deriveInitialStockRequestId(KEY)).not.toBe(deriveInitialStockRequestId(OTHER_KEY));
  });

  it("producto insertado y proceso caído antes del stock: el reintento completa el inventario_inicial una sola vez", async () => {
    const database = useDatabase();

    database.hooks.rpcCrash = new Error("socket hang up");
    await expect(createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID)).rejects.toThrow("socket hang up");
    expect(totals(database)).toEqual({ inventarioInicial: 0, productos: 1, unidades: 0 });

    await createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);
    await createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);

    expect(totals(database)).toEqual({ inventarioInicial: 1, productos: 1, unidades: 9 });
  });

  it("dos envíos del mismo alta a la vez: el que pierde el insert (23505 del índice de la clave) devuelve el producto del otro", async () => {
    // La huella que guarda un alta de `harina`, para montar la fila del otro envío.
    const reference = useDatabase();
    await createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);
    const hash = reference.products[0]?.client_request_hash;

    const racing = useDatabase();
    // El otro envío inserta entre la consulta previa de este y su insert, y aún no registró su stock.
    racing.hooks.beforeInsert = () => {
      racing.insertProduct({ client_request_hash: hash, client_request_id: KEY, sku: "del-otro-envio", store_id: DEFAULT_STORE_ID });
    };

    const loser = await createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);

    expect(loser.id).toBe("prod-1");
    expect(racing.products.map((product) => product.sku)).toEqual(["del-otro-envio"]);
    expect(totals(racing)).toEqual({ inventarioInicial: 1, productos: 1, unidades: 9 });
    expect(racing.log.deletes).toBe(0);
  });

  it("la misma clave con otro contenido no es un reintento: 409 y no se crea ni se mueve nada", async () => {
    const database = useDatabase();

    await createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);

    await expect(
      createProduct({ ...harina, clientRequestId: KEY, currentStock: 20 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code: "CONFLICT", message: PRODUCT_CREATE_REQUEST_REUSED_MESSAGE, status: 409 });
    expect(totals(database)).toEqual({ inventarioInicial: 1, productos: 1, unidades: 9 });
  });

  it("otra clave es otro alta", async () => {
    const database = useDatabase();

    await createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);
    await createProduct({ ...harina, clientRequestId: OTHER_KEY }, DEFAULT_STORE_ID);

    expect(totals(database)).toEqual({ inventarioInicial: 2, productos: 2, unidades: 18 });
  });
});

describe("updateProductPrice · costo esperado (PRO-F9, ALTA-1)", () => {
  it("con expectedCostRef cambia el precio por update_product_price_checked, que compara y cambia en la misma transacción", async () => {
    const database = useDatabase();
    database.insertProduct({ sku: "harina", store_id: DEFAULT_STORE_ID });

    await updateProductPrice("prod-1", { expectedCostRef: 12, reason: "Reprecio al 30 %", salePriceRef: 15.6 }, DEFAULT_STORE_ID).catch(
      () => undefined,
    );

    expect(database.log.rpcs[0]).toEqual({
      args: { p_expected_cost_ref: 12, p_new_sale_price_ref: 15.6, p_product_id: "prod-1", p_reason: "Reprecio al 30 %" },
      name: "update_product_price_checked",
    });
  });

  it("sin expectedCostRef sigue llamando a update_product_price con los mismos argumentos de siempre", async () => {
    const database = useDatabase();
    database.insertProduct({ sku: "harina", store_id: DEFAULT_STORE_ID });

    await updateProductPrice("prod-1", { reason: null, salePriceRef: 15.6 }, DEFAULT_STORE_ID).catch(() => undefined);

    expect(database.log.rpcs[0]).toEqual({
      args: { p_new_sale_price_ref: 15.6, p_product_id: "prod-1", p_reason: null },
      name: "update_product_price",
    });
  });

  it("el PT409 de la base llega como 409 con su mensaje y no se lee nada más", async () => {
    const database = useDatabase();
    database.client.rpc = async (name: string, args: Row) => {
      database.log.rpcs.push({ args, name });

      return {
        data: null,
        error: { code: "PT409", hint: "COST_CHANGED", message: "El costo cambió de 12.00 a 20.00; revisa el precio" },
      };
    };
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(database.client);

    await expect(
      updateProductPrice("prod-1", { expectedCostRef: 12, salePriceRef: 15.6 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "El costo cambió de 12.00 a 20.00; revisa el precio",
      status: 409,
    });
    expect(database.log.rpcs).toHaveLength(1);
  });
});
