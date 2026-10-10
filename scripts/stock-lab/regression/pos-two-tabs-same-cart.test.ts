/**
 * POS-H6 · Dos pestañas del POS con el mismo carrito cobran a la vez (hallazgo D63-3).
 *
 * La clave de idempotencia del cobro se deriva del carrito
 * (`src/modules/sales/sale-create/utils/saleRequestId.ts`): dos pestañas con una copia
 * del mismo carrito envían la MISMA `clientRequestId` aunque ninguna haya visto la marca
 * «cobrando» de la otra. Aquí se comprueba la otra mitad de la garantía: con esa clave
 * derivada, dos cobros SIMULTÁNEOS del mismo carrito dejan una sola venta y descuentan
 * el stock una sola vez, sin ningún 5xx. Una ronda de control con dos claves distintas
 * deja dos ventas: demuestra que lo que evita el duplicado es la clave y no el montaje.
 *
 * Corre contra la base lab local (`npm run stock-lab:test`), por el camino real y con
 * los mismos argumentos que arma `POST /api/sales` (`createSale` en
 * `src/modules/sales/services/sales.server.ts`): supabase-js con la anon key + sesión de
 * un vendedor lab → `create_sale_with_payments`. `pg` (rol postgres) solo prepara datos y
 * lee el resultado.
 *
 * Datos propios con prefijo `POSH6-<nonce>`; se borran en `afterAll`. Un fallo de
 * preparación lanza un error que empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { deriveSaleRequestId } from "../../../src/modules/sales/sale-create/utils/saleRequestId";
import { Lab } from "../scenarios/db";

type Row = Record<string, unknown>;
type RpcOutcome = {
  code: string | null;
  message: string | null;
  saleId: string | null;
  status: number;
};

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `POSH6-${NONCE}`;
const ROUNDS = 20;
const QUANTITY = 2;
/** Alcanza para las rondas, la de control y la de otro contenido. */
const INITIAL_STOCK = (ROUNDS + 4) * QUANTITY;

let lab: Lab;
let seq = 0;
const productIds: string[] = [];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

/** Envuelve una fase de preparación: si falla, el error dice SETUP (no es la reproducción). */
async function setup<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`SETUP ${what}: ${messageOf(error)}`);
  }
}

async function rate(): Promise<number> {
  const rows = await lab.rows(
    "select rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  if (!rows[0]) throw new Error("SETUP sin tasa de cambio en la tienda lab");
  return Number(rows[0].rate_ves);
}

/** Producto propio: nace con stock 0 por `pg` y recibe su stock por `adjust_stock` (lab-admin). */
async function mkProduct(key: string, stock: number): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${key}-${seq}`;
  const rows = await lab.rows(
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $3, 1, 0.5, 0, 0, true) returning id`,
    [lab.storeId, sku, `Producto ${sku}`],
  );
  const id = String(rows[0]?.id);
  productIds.push(id);
  const admin = await lab.supa("admin");
  const { error } = await admin.rpc("adjust_stock", {
    p_product_id: id,
    p_quantity_delta: stock,
    p_reason: `${TAG} inventario inicial`,
    p_type: "inventario_inicial",
  });
  if (error) throw new Error(`adjust_stock: ${error.code ?? ""} ${error.message}`);
  if ((await lab.stock(id)) !== stock) throw new Error(`producto ${sku}: stock inicial distinto de ${stock}`);
  return id;
}

/** Lo que el POS manda a `POST /api/sales`, sin cobros: producto y cantidad; el precio lo pone el servidor. */
type PosCart = { customerId: string; items: Array<{ productId: string; quantity: number }> };

/** Los argumentos que `createSale` (BFF) pasa a `create_sale_with_payments` para ese cuerpo. */
function rpcArgs(cart: PosCart, clientRequestId: string, refRateVes: number, invoiceNumber: string | null = null): Row {
  return {
    p_client_request_id: clientRequestId,
    p_customer_id: cart.customerId,
    p_discount_ref: 0,
    p_exchange_rate_id: null,
    p_invoice_number: invoiceNumber,
    p_items: cart.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_notes: null,
    p_payments: [],
    p_ref_rate_ves: refRateVes,
    p_tax_ref: 0,
  };
}

/** Un cobro, como una pestaña del POS: respuesta HTTP de PostgREST incluida. */
async function charge(args: Row): Promise<RpcOutcome> {
  const client = await setup("sesión de vendedor1", () => lab.supa("vendedor1"));
  const { data, error, status } = await client.rpc("create_sale_with_payments", args);
  return {
    code: error?.code ?? null,
    message: error?.message ?? null,
    saleId: error ? null : String((data as Row | null)?.id ?? ""),
    status,
  };
}

async function salesWithKey(clientRequestId: string): Promise<string[]> {
  const rows = await lab.rows(
    "select id from public.sales where store_id = $1 and client_request_id = $2 order by created_at",
    [lab.storeId, clientRequestId],
  );
  return rows.map((row) => String(row.id));
}

/** Ventas vivas que llevan ese producto: la clave no entra en la cuenta. */
async function salesOfProduct(productId: string): Promise<number> {
  const rows = await lab.rows(
    "select count(distinct sale_id)::int as total from public.sale_items where product_id = $1",
    [productId],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Unidades que el libro dice que salieron por venta de ese producto. */
async function unitsSoldInLedger(productId: string): Promise<number> {
  const rows = await lab.rows(
    "select coalesce(-sum(quantity_delta), 0)::float8 as total from public.stock_movements where product_id = $1 and type::text = 'venta'",
    [productId],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Borra todo lo creado por este archivo; si algo lo impide, deja los productos inactivos. */
async function cleanup(): Promise<void> {
  if (productIds.length === 0) return;
  try {
    await lab.db.query("begin");
    const sales = (
      await lab.rows("select distinct sale_id as id from public.sale_items where product_id = any($1::uuid[])", [productIds])
    ).map((row) => row.id);
    await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [productIds]);
    await lab.db.query("delete from public.sales where id = any($1::uuid[])", [sales]);
    await lab.db.query("delete from public.products where id = any($1::uuid[])", [productIds]);
    await lab.db.query("commit");
  } catch {
    await lab.db.query("rollback").catch(() => undefined);
    await lab.db
      .query("update public.products set is_active = false where id = any($1::uuid[])", [productIds])
      .catch(() => undefined);
  }
}

beforeAll(async () => {
  lab = await setup("abrir el laboratorio", () => Lab.open("posh6"));
});

afterAll(async () => {
  if (!lab) return;
  await cleanup();
  await lab.close();
});

describe("POS-H6 · dos pestañas con el mismo carrito cobran a la vez", () => {
  it(`${ROUNDS} rondas: misma clave derivada y mismo cuerpo → 1 venta por ronda, stock descontado una vez, sin 5xx`, async () => {
    const productId = await setup("producto", () => mkProduct("dos-pestanas", INITIAL_STOCK));
    const refRateVes = await setup("tasa", rate);
    const cart: PosCart = { customerId: lab.customerId, items: [{ productId, quantity: QUANTITY }] };
    const keys = new Set<string>();
    const failures: string[] = [];

    for (let round = 1; round <= ROUNDS; round += 1) {
      // Cada ronda es una venta nueva: carrito con identidad propia, mismos productos.
      const cartId = randomUUID();
      const tabA = deriveSaleRequestId(cartId, cart);
      const tabB = deriveSaleRequestId(cartId, { customerId: cart.customerId, items: [...cart.items] });
      const stockBefore = await lab.stock(productId);
      const salesBefore = await salesOfProduct(productId);

      const outcomes = await Promise.all([
        charge(rpcArgs(cart, tabA, refRateVes)),
        charge(rpcArgs(cart, tabB, refRateVes)),
      ]);

      const created = await salesWithKey(tabA);
      const salesAfter = await salesOfProduct(productId);
      const stockAfter = await lab.stock(productId);
      const problems: string[] = [];

      if (tabA !== tabB) problems.push("las dos pestañas derivaron claves distintas");
      if (keys.has(tabA)) problems.push("la clave repite la de una ronda anterior");
      keys.add(tabA);
      if (created.length !== 1) problems.push(`${created.length} ventas con la clave`);
      if (salesAfter - salesBefore !== 1) problems.push(`${salesAfter - salesBefore} ventas nuevas del producto`);
      if (stockBefore - stockAfter !== QUANTITY) problems.push(`stock ${stockBefore} → ${stockAfter}`);
      for (const outcome of outcomes) {
        if (outcome.status >= 500) problems.push(`respuesta ${outcome.status}: ${outcome.message}`);
        // Mismo contenido: las dos pestañas reciben la venta, la misma.
        if (outcome.saleId !== created[0]) {
          problems.push(`una pestaña recibió ${outcome.saleId ?? `${outcome.status} ${outcome.code} ${outcome.message}`}`);
        }
      }

      if (problems.length > 0) failures.push(`ronda ${round}: ${problems.join("; ")}`);
    }

    expect(failures).toEqual([]);
    expect(keys.size).toBe(ROUNDS);
    // El libro cuadra con el stock: una salida por venta, ni una más.
    expect(await lab.stock(productId)).toBe(INITIAL_STOCK - ROUNDS * QUANTITY);
    expect(await unitsSoldInLedger(productId)).toBe(ROUNDS * QUANTITY);
  });

  it("misma clave con OTRO contenido a la vez: una sola venta y la otra petición recibe 409 (nunca 5xx)", async () => {
    const productId = await setup("producto", () => mkProduct("otro-contenido", INITIAL_STOCK));
    const refRateVes = await setup("tasa", rate);
    const cart: PosCart = { customerId: lab.customerId, items: [{ productId, quantity: QUANTITY }] };
    const key = deriveSaleRequestId(randomUUID(), cart);
    // Lo que hace el servidor cuando las dos pestañas comparten clave y su contenido difiere
    // (en el POS, otro método de pago; aquí, otra cantidad, que no necesita caja abierta).
    const other: PosCart = { ...cart, items: [{ productId, quantity: QUANTITY + 1 }] };

    const outcomes = await Promise.all([
      charge(rpcArgs(cart, key, refRateVes)),
      charge(rpcArgs(other, key, refRateVes)),
    ]);

    const created = await salesWithKey(key);
    const winner = outcomes.find((outcome) => outcome.saleId !== null);
    const sold = winner === outcomes[0] ? QUANTITY : QUANTITY + 1;

    expect(outcomes.map((outcome) => outcome.status).filter((status) => status >= 500)).toEqual([]);
    expect(outcomes.filter((outcome) => outcome.saleId !== null)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 409 && outcome.code === "PT409")).toHaveLength(1);
    expect(created).toEqual([winner?.saleId]);
    expect(await salesOfProduct(productId)).toBe(1);
    expect(await lab.stock(productId)).toBe(INITIAL_STOCK - sold);
    expect(await unitsSoldInLedger(productId)).toBe(sold);
  });

  it("control · el mismo carrito con dos claves DISTINTAS a la vez deja dos ventas (el test muerde)", async () => {
    const productId = await setup("producto", () => mkProduct("control", INITIAL_STOCK));
    const refRateVes = await setup("tasa", rate);
    const cart: PosCart = { customerId: lab.customerId, items: [{ productId, quantity: QUANTITY }] };
    // Dos carritos distintos con lo mismo dentro: lo que enviaba cada pestaña antes de POS-H6.
    const keyA = deriveSaleRequestId(randomUUID(), cart);
    const keyB = deriveSaleRequestId(randomUUID(), cart);

    expect(keyA).not.toBe(keyB);

    // Factura propia en cada una: el control no depende de la numeración automática.
    const outcomes = await Promise.all([
      charge(rpcArgs(cart, keyA, refRateVes, `${TAG}-CTRL-A`)),
      charge(rpcArgs(cart, keyB, refRateVes, `${TAG}-CTRL-B`)),
    ]);

    expect(outcomes.map((outcome) => outcome.message)).toEqual([null, null]);
    expect(new Set(outcomes.map((outcome) => outcome.saleId)).size).toBe(2);
    expect(await salesOfProduct(productId)).toBe(2);
    expect(await lab.stock(productId)).toBe(INITIAL_STOCK - 2 * QUANTITY);
  });
});
