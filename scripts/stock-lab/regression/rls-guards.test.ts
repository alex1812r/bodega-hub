/**
 * STK-412 · Regresión de las causas de capa RLS / guardas de rol (C2, C9, C17, C18).
 *
 * Cada test enuncia el comportamiento SANO y hoy está ROJO: reproduce una causa
 * de `.notes/stock-integrity-gtm/causes.md` sin corregir (la corrección es de la
 * fase 5). Corre contra la base lab local (`npm run stock-lab:test`), por el
 * camino real: supabase-js con la anon key + sesión de un usuario lab. `pg`
 * (rol postgres) solo prepara datos y lee el resultado.
 *
 * Datos propios con prefijo `R412-<nonce>`; se borran en `afterAll`. Un fallo
 * de preparación lanza un error que empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { LabRoleKey } from "../agents/base";
import { Lab } from "../scenarios/db";

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `R412-${NONCE}`;
const OWN_PASSWORD = "R412-propio!";

let lab: Lab;
let seq = 0;
const productIds: string[] = [];
const ownUserIds: string[] = [];

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

async function rpc(client: SupabaseClient, fn: string, args: Row): Promise<RpcResult> {
  const { data, error } = await client.rpc(fn, args);
  return { data, error };
}

/** RPC de preparación: debe funcionar; si no, es un fallo de SETUP. */
async function rpcOk(role: LabRoleKey, fn: string, args: Row): Promise<Row> {
  const res = await rpc(await lab.supa(role), fn, args);
  if (res.error) throw new Error(`SETUP ${fn} como ${role}: ${res.error.code ?? ""} ${res.error.message}`);
  return (res.data ?? {}) as Row;
}

async function one(text: string, params: unknown[]): Promise<Row> {
  const rows = await lab.rows(text, params);
  if (!rows[0]) throw new Error(`SETUP sin filas: ${text}`);
  return rows[0];
}

async function rate(): Promise<number> {
  const row = await one(
    "select rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  return Number(row.rate_ves);
}

/**
 * Producto propio. Nace con stock 0 por `pg` y recibe su stock por `adjust_stock`
 * (lab-admin), para no depender de que la base siga aceptando `current_stock`
 * escrito a mano cuando se corrija C1/C2.
 */
async function mkProduct(key: string, stock: number, opts: { price?: number; minStock?: number } = {}): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${key}-${seq}`;
  const row = await one(
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $3, $4, 0.5, 0, $5, true) returning id`,
    [lab.storeId, sku, `Producto ${sku}`, opts.price ?? 1, opts.minStock ?? 0],
  );
  const id = String(row.id);
  productIds.push(id);
  if (stock > 0) {
    await rpcOk("admin", "adjust_stock", {
      p_product_id: id,
      p_quantity_delta: stock,
      p_reason: `${TAG} inventario inicial`,
      p_type: "inventario_inicial",
    });
  }
  if ((await lab.stock(id)) !== stock) throw new Error(`SETUP producto ${sku}: stock inicial distinto de ${stock}`);
  return id;
}

async function mkSale(role: LabRoleKey, productId: string, quantity: number): Promise<Row> {
  seq += 1;
  return rpcOk(role, "create_sale", {
    p_customer_id: lab.customerId,
    p_items: [{ product_id: productId, quantity, unit_price_ref: 1 }],
    p_exchange_rate_id: null,
    p_ref_rate_ves: await rate(),
    p_invoice_number: `${TAG}-V${seq}`,
  });
}

async function mkPurchase(productId: string, quantity: number, status: "pedido" | "recibido"): Promise<Row> {
  seq += 1;
  const r = await rate();
  const subtotalRef = Math.round(quantity * 0.5 * 100) / 100;
  const subtotalVes = Math.round(subtotalRef * r * 100) / 100;
  return rpcOk("almacen", "create_purchase", {
    p_supplier_id: lab.supplierId,
    p_items: [
      {
        product_id: productId,
        quantity,
        unit_cost_ref: 0.5,
        unit_cost_ves: Math.round(0.5 * r * 100) / 100,
        subtotal_ref: subtotalRef,
        subtotal_ves: subtotalVes,
        tax_rate: 0,
        tax_ref: 0,
        tax_ves: 0,
      },
    ],
    p_exchange_rate_id: null,
    p_ref_rate_ves: r,
    p_discount_ref: 0,
    p_tax_ref: 0,
    p_purchase_number: `${TAG}-C${seq}`,
    p_status: status,
    p_discount_ves: 0,
    p_tax_ves: 0,
    p_subtotal_ves: subtotalVes,
    p_subtotal_ref: subtotalRef,
  });
}

/** Los cobros en efectivo exigen sesión de caja abierta del vendedor: se abre si no hay y no se cierra. */
async function ensureCashSession(role: "vendedor1" | "vendedor2"): Promise<void> {
  const open = () =>
    lab.rows(
      `select s.id from public.cash_sessions s join public.cash_registers r on r.id = s.register_id
       where r.assigned_user_id = $1 and r.is_active and s.status = 'open'`,
      [lab.uids[role]],
    );
  if ((await open()).length > 0) return;
  const register = await one(
    "select id from public.cash_registers where store_id = $1 and assigned_user_id = $2 and is_active limit 1",
    [lab.storeId, lab.uids[role]],
  );
  const res = await rpc(await lab.supa(role), "open_cash_session", {
    p_register_id: register.id,
    p_opening_ves: 0,
    p_opening_ref: 0,
  });
  // Otro proceso pudo abrirla a la vez: lo que importa es que quede una abierta.
  if ((await open()).length === 0) throw new Error(`SETUP caja de ${role}: ${res.error?.message ?? "sin sesión abierta"}`);
}

/** Usuario propio (Auth admin API local + perfil por el trigger `handle_new_user`) con sesión iniciada. */
async function mkUser(key: string, role: string, storeId: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `${TAG}-${key}@lab.local`.toLowerCase();
  const { data, error } = await lab.service().auth.admin.createUser({
    email,
    password: OWN_PASSWORD,
    email_confirm: true,
    user_metadata: { role, store_id: storeId, full_name: `${TAG} ${key}` },
  });
  if (error || !data.user) throw new Error(`SETUP crear usuario ${email}: ${error?.message ?? "sin usuario"}`);
  const id = data.user.id;
  ownUserIds.push(id);
  const profile = await one("select role::text as role, store_id, is_active from public.profiles where id = $1", [id]);
  if (profile.role !== role || profile.store_id !== storeId || profile.is_active !== true) {
    throw new Error(`SETUP perfil de ${email} inesperado: ${JSON.stringify(profile)}`);
  }
  return { id, client: await lab.newSupa(email, OWN_PASSWORD) };
}

/** Borra todo lo creado por este archivo; si algo lo impide, deja los productos inactivos. */
async function cleanup(): Promise<void> {
  if (productIds.length > 0) {
    try {
      await lab.db.query("begin");
      const sales = (await lab.rows("select distinct sale_id as id from public.sale_items where product_id = any($1::uuid[])", [productIds])).map((r) => r.id);
      const purchases = (await lab.rows("select distinct purchase_id as id from public.purchase_items where product_id = any($1::uuid[])", [productIds])).map((r) => r.id);
      const payments = (await lab.rows("select id from public.payments where sale_id = any($1::uuid[]) or purchase_id = any($2::uuid[])", [sales, purchases])).map((r) => r.id);
      await lab.db.query("delete from public.cash_movements where payment_id = any($1::uuid[])", [payments]);
      await lab.db.query("delete from public.vault_movements where payment_id = any($1::uuid[])", [payments]);
      await lab.db.query("delete from public.payments where id = any($1::uuid[])", [payments]);
      await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [productIds]);
      await lab.db.query("delete from public.sales where id = any($1::uuid[])", [sales]);
      await lab.db.query("delete from public.purchases where id = any($1::uuid[])", [purchases]);
      await lab.db.query("delete from public.products where id = any($1::uuid[])", [productIds]);
      await lab.db.query("commit");
    } catch {
      await lab.db.query("rollback").catch(() => undefined);
      await lab.db.query("update public.products set is_active = false where id = any($1::uuid[])", [productIds]).catch(() => undefined);
    }
  }
  for (const id of ownUserIds) {
    await lab.db.query("update public.profiles set is_active = false where id = $1", [id]).catch(() => undefined);
    await lab.service().auth.admin.deleteUser(id).catch(() => undefined);
  }
}

beforeAll(async () => {
  lab = await setup("abrir el laboratorio", () => Lab.open("r412"));
});

afterAll(async () => {
  if (!lab) return;
  await cleanup();
  await lab.close();
});

// Hipótesis H7 · hueco G1. Evento reproductor: ola `w4-hyp` caso `h07.dg1_direct_update_postgrest`
// y `qa/STK-409/verdict.md` §3.1 (PATCH /rest/v1/products {current_stock:999} → 200, 1 fila, sin movimiento).
// Política `Admins and warehouse manage products` (`for all`): supabase/patches/20260716-multi-store.sql:335;
// no existe trigger que ate `products.current_stock` a `stock_movements`.
describe("C2 · current_stock no se escribe fuera de las RPC", () => {
  it.each(["admin", "almacen"] as const)(
    "C2 · un UPDATE directo de products.current_stock por PostgREST como %s no cambia el stock",
    async (role) => {
      const productId = await setup("producto", () => mkProduct(`c2-${role}`, 10));
      const client = await setup("sesión", () => lab.supa(role));
      try {
        await client.from("products").update({ current_stock: 999 }).eq("id", productId).select("id, current_stock");

        const ledger = await one(
          "select coalesce(sum(quantity_delta), 0)::int as total from public.stock_movements where product_id = $1",
          [productId],
        );
        expect(ledger.total).toBe(10);
        // Sano: la escritura se rechaza (o no afecta filas) y el stock sigue igual al libro.
        expect(await lab.stock(productId)).toBe(10);
      } finally {
        // Deja el producto cuadrado aunque el test falle (solo si de verdad cambió).
        await lab.db
          .query("update public.products set current_stock = 10 where id = $1 and current_stock <> 10", [productId])
          .catch(() => undefined);
      }
    },
  );
});

// Hipótesis H12 · hueco G2 · caso 9.9. Evento reproductor: ola `w4-hyp` caso `h12.dg2_inactive_user`
// y `qa/STK-409/verdict.md` §3.2 (JWT previo a la desactivación: adjust +5, cancel, receive y venta → 200).
// `current_user_role()` devuelve NULL con `is_active = false` (supabase/supabase-schema.sql:541) y
// `NULL not in (...)` no lanza: 20260813h-fix-adjust-stock-store-id.sql:32, 20260813b-product-cost-with-line-tax.sql:386,
// 20260810-rpc-store-context.sql:983, 20260904c-sale-integrity.sql:77; `assert_store_context` (20260716-multi-store.sql:129) no mira `is_active`.
describe("C9 · un usuario desactivado no ejecuta RPC de stock", () => {
  let inactive: SupabaseClient;
  let inactiveId = "";

  beforeAll(async () => {
    await setup("usuario propio desactivado", async () => {
      const user = await mkUser("inactivo", "vendedor", lab.storeId);
      inactive = user.client;
      inactiveId = user.id;
      // La sesión (JWT) se emitió con el usuario activo; ahora se desactiva, como hace la app.
      await lab.db.query("update public.profiles set is_active = false where id = $1", [inactiveId]);
      const profile = await one("select is_active from public.profiles where id = $1", [inactiveId]);
      if (profile.is_active !== false) throw new Error("el perfil sigue activo");
    });
  });

  it("C9 · adjust_stock con un usuario desactivado se rechaza y no mueve stock", async () => {
    const productId = await setup("producto", () => mkProduct("c9-adjust", 10));

    const res = await rpc(inactive, "adjust_stock", {
      p_product_id: productId,
      p_quantity_delta: 5,
      p_reason: `${TAG} usuario inactivo`,
      p_type: null,
    });

    expect({ rechazada: res.error !== null, stock: await lab.stock(productId) }).toEqual({ rechazada: true, stock: 10 });
  });

  it("C9 · receive_purchase con un usuario desactivado se rechaza y la compra sigue en pedido", async () => {
    const productId = await setup("producto", () => mkProduct("c9-receive", 10));
    const purchase = await setup("compra en pedido", () => mkPurchase(productId, 4, "pedido"));

    const res = await rpc(inactive, "receive_purchase", { p_purchase_id: purchase.id });

    const after = await one("select status::text as status from public.purchases where id = $1", [purchase.id]);
    expect({ rechazada: res.error !== null, estado: after.status, stock: await lab.stock(productId) }).toEqual({
      rechazada: true,
      estado: "pedido",
      stock: 10,
    });
  });

  it("C9 · cancel_purchase con un usuario desactivado se rechaza y la compra sigue recibida", async () => {
    const productId = await setup("producto", () => mkProduct("c9-cancel", 10));
    const purchase = await setup("compra recibida", () => mkPurchase(productId, 3, "recibido"));
    await setup("stock tras recibir", async () => {
      if ((await lab.stock(productId)) !== 13) throw new Error("la compra recibida no sumó 3 unidades");
    });

    const res = await rpc(inactive, "cancel_purchase", { p_purchase_id: purchase.id });

    const after = await one("select status::text as status from public.purchases where id = $1", [purchase.id]);
    expect({ rechazada: res.error !== null, estado: after.status, stock: await lab.stock(productId) }).toEqual({
      rechazada: true,
      estado: "recibido",
      stock: 13,
    });
  });

  it("C9 · create_sale con un usuario desactivado se rechaza y no descuenta stock", async () => {
    const productId = await setup("producto", () => mkProduct("c9-sale", 10));
    const r = await setup("tasa", rate);

    const res = await rpc(inactive, "create_sale", {
      p_customer_id: lab.customerId,
      p_items: [{ product_id: productId, quantity: 1, unit_price_ref: 1 }],
      p_exchange_rate_id: null,
      p_ref_rate_ves: r,
      p_invoice_number: `${TAG}-V-inactivo`,
    });

    const sales = await lab.rows("select id from public.sales where user_id = $1", [inactiveId]);
    expect({ rechazada: res.error !== null, ventas: sales.length, stock: await lab.stock(productId) }).toEqual({
      rechazada: true,
      ventas: 0,
      stock: 10,
    });
  });
});

// Caso propio de caos N3. Evento reproductor: `caos/propios.md` §N3 y `caos/scripts/b3-cross.ts` §4 (4/4:
// PATCH /rest/v1/sales|purchases|payments con la anon key + JWT → 200, 1 fila).
// Políticas sin restricción de columnas ni trigger: `Admins update sales` (supabase/supabase-schema.sql:2286),
// `Admins update purchases` (:2311), `Admins and accountants update payment metadata` (:2336).
describe("C17 · ventas, compras y pagos no se editan por PostgREST sin RPC", () => {
  type Face = {
    name: string;
    table: "sales" | "purchases" | "payments";
    role: LabRoleKey;
    columns: string;
    patch: Row;
    prepare: () => Promise<string>;
  };

  const pendingSale = async (key: string): Promise<Row> => mkSale("vendedor1", await mkProduct(key, 10), 1);

  const faces: Face[] = [
    {
      name: "el estado de una venta (admin)",
      table: "sales",
      role: "admin",
      columns: "status::text as status",
      patch: { status: "cancelada" },
      prepare: async () => String((await pendingSale("c17-sale-status")).id),
    },
    {
      name: "los importes de una venta (admin)",
      table: "sales",
      role: "admin",
      columns: "total_ref::text as total_ref, total_ves::text as total_ves, paid_ves::text as paid_ves",
      patch: { total_ref: 0.01, total_ves: 1, paid_ves: 1 },
      prepare: async () => String((await pendingSale("c17-sale-amounts")).id),
    },
    {
      name: "el estado de una compra (admin)",
      table: "purchases",
      role: "admin",
      columns: "status::text as status",
      patch: { status: "recibido" },
      prepare: async () => String((await mkPurchase(await mkProduct("c17-purchase", 10), 2, "pedido")).id),
    },
    {
      name: "el importe y el estado de un pago (contador)",
      table: "payments",
      role: "contador",
      columns: "amount_ves::text as amount_ves, status::text as status",
      patch: { amount_ves: 1, status: "anulado" },
      prepare: async () => {
        await ensureCashSession("vendedor1");
        const sale = await pendingSale("c17-payment");
        const payment = await rpcOk("vendedor1", "register_payment", {
          p_sale_id: sale.id,
          p_method: "efectivo_ves",
          p_amount: Number(sale.total_ves),
        });
        return String(payment.id);
      },
    },
  ];

  it.each(faces)("C17 · un UPDATE directo por PostgREST no cambia $name", async (face) => {
    const id = await setup(face.name, face.prepare);
    const read = () => one(`select ${face.columns} from public.${face.table} where id = $1`, [id]);
    const before = await setup("lectura previa", read);
    const client = await setup("sesión", () => lab.supa(face.role));
    try {
      await client.from(face.table).update(face.patch).eq("id", id).select("id");

      // Sano: la escritura se rechaza (o afecta 0 filas); estado e importes solo cambian por RPC.
      expect(await read()).toEqual(before);
    } finally {
      // Restaura la fila para no dejar documentos descuadrados si el test falla.
      const sets = Object.keys(before).map((column, index) => `${column} = $${index + 2}`);
      await lab.db
        .query(`update public.${face.table} set ${sets.join(", ")} where id = $1`, [id, ...Object.values(before)])
        .catch(() => undefined);
    }
  });
});

// Caso propio de caos N2. Evento reproductor: `caos/propios.md` §N2, `caos/scripts/out-n2-anon-views.txt`
// (7/7 vistas con filas usando solo la anon key) y `caos/scripts/b3-cross.ts` §3 (lectura entre tiendas).
// Vistas sin `security_invoker` y con select para anon/authenticated:
// supabase/patches/20260716b-multi-store-views.sql:16-90 y 20260811-pack-unit-conversion.sql:101 (`stock_card`).
describe("C18 · las vistas de reportes no se leen sin sesión ni entre tiendas", () => {
  const VIEWS = [
    "stock_card",
    "daily_sales_summary",
    "gross_profit_summary",
    "product_profitability",
    "customer_purchase_summary",
    "supplier_purchase_summary",
    "low_stock_products",
  ] as const;

  let outsider: SupabaseClient;

  beforeAll(async () => {
    await setup("datos de la tienda lab en las 7 vistas", async () => {
      // Producto bajo mínimo con una venta viva: da filas propias a kardex, ventas, margen y stock bajo.
      const productId = await mkProduct("c18", 5, { minStock: 100 });
      await mkSale("vendedor1", productId, 1);
      for (const view of VIEWS) {
        const row = await one(`select count(*)::int as n from public.${view} where store_id = $1`, [lab.storeId]);
        if (Number(row.n) === 0) throw new Error(`la vista ${view} no tiene filas de la tienda lab`);
      }
    });
    // Usuario propio de OTRA tienda (default): no se mueve de tienda a ningún usuario sembrado.
    outsider = (await setup("usuario propio de otra tienda", () => mkUser("otra-tienda", "admin", lab.defaultStoreId))).client;
  });

  it.each(VIEWS)("C18 · %s no devuelve filas con la anon key sin sesión", async (view) => {
    const { data } = await lab.anon().from(view).select("store_id").limit(5);

    // Sano: 401/permiso denegado o lista vacía (como `products` y `sales`).
    expect((data ?? []).length).toBe(0);
  });

  it.each(VIEWS)("C18 · %s no devuelve filas de la tienda lab a un usuario de otra tienda", async (view) => {
    const { data } = await outsider.from(view).select("store_id").eq("store_id", lab.storeId).limit(5);

    expect((data ?? []).length).toBe(0);
  });
});
