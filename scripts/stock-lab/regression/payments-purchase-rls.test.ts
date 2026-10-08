/** @jest-environment node */
/**
 * COM-16 · regresión del parche `20261010c-payments-purchase-rls.sql` (decisión D23): los pagos de COMPRAS
 * (`payments.purchase_id` no nulo) solo los leen admin y contador. Antes la política de lectura era
 * `store_id = current_user_store_id()` para cualquier rol y vendedor y almacén leían con su JWT los pagos a
 * proveedores que el BFF les niega (`.notes/ux-mejoras/caos/pagos/informe-servidor.md`).
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en
 * `rollback` (patrón de `rpc-review-h.test.ts`): los datos se crean por las RPC reales como el usuario lab que
 * toca y cada sentencia probada se ejecuta con `set local role authenticated` + `request.jwt.claims` del usuario,
 * que es exactamente lo que hace PostgREST (misma ACL y misma RLS). El usuario de OTRA tienda es
 * `admin@example.com` (tienda `default`). Nada persiste: no hay limpieza.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/payments-purchase-rls.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };
type Fixture = {
  purchaseId: string;
  purchasePaymentIds: string[];
  saleId: string;
  salePaymentId: string;
};

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `RC16-${NONCE}`;
const OTHER_STORE_ADMIN_EMAIL = "admin@example.com";

/** Roles con permiso de ver pagos de compras y roles sin él. */
const ALLOWED: LabRoleKey[] = ["admin", "contador"];
const DENIED: LabRoleKey[] = ["vendedor1", "vendedor2", "almacen"];
const EVERYONE: LabRoleKey[] = [...ALLOWED, ...DENIED];

let lab: Lab;
let db: Client;
let rateVes = 0;
let seq = 0;
let otherAdmin = "";

function nextTag(name: string): string {
  seq += 1;
  return `${TAG}-${name}-${seq}`;
}

function failure(error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown }).code;
  return { code: typeof code === "string" ? code : "?", message: error instanceof Error ? error.message : String(error) };
}

/** SQL de preparación / lectura como `postgres` (sin RLS). Si falla, el test no pudo montarse. */
async function sql(what: string, text: string, params: unknown[] = []): Promise<Row[]> {
  try {
    return (await db.query<Row>(text, params)).rows;
  } catch (error) {
    const { code, message } = failure(error);
    throw new Error(`SETUP · ${what}: ${code} ${message}`);
  }
}

async function one(what: string, text: string, params: unknown[] = []): Promise<Row> {
  const rows = await sql(what, text, params);
  if (!rows[0]) throw new Error(`SETUP · ${what}: sin filas`);
  return rows[0];
}

/**
 * Ejecuta `text` como el usuario `uid` (rol `authenticated` + claims) dentro de un savepoint. Devuelve el error
 * (SQLSTATE + mensaje) en vez de lanzarlo y deja la transacción utilizable y de vuelta en el rol de la sesión.
 */
async function asUser(uid: string | null, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint rc16_as_user");
  try {
    await actAs(db, uid);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint rc16_as_user");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint rc16_as_user");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

function as(role: LabRoleKey, text: string, params: unknown[] = []): Promise<Outcome> {
  return asUser(lab.uids[role], text, params);
}

/** Llamada de preparación como usuario lab: debe salir bien y devolver una fila. */
async function must(what: string, role: LabRoleKey, text: string, params: unknown[] = []): Promise<Row> {
  const out = await as(role, text, params);
  if (out.code !== null || !out.rows[0]) throw new Error(`SETUP · ${what}: ${out.code ?? "sin filas"} ${out.message}`);
  return out.rows[0];
}

/** Ids que devuelve una lectura que debe salir sin error (0 filas no es un error: es lo que hace la RLS). */
async function ids(role: LabRoleKey, text: string, params: unknown[] = []): Promise<string[]> {
  const out = await as(role, text, params);
  expect({ role, code: out.code, message: out.message }).toEqual({ role, code: null, message: "" });
  return out.rows.map((row) => String(row.id)).sort();
}

/** Producto (stock 0); el stock inicial entra con su movimiento `inventario_inicial` (lo aplica el trigger). */
async function product(name: string, stock: number): Promise<string> {
  const sku = nextTag(name).toLowerCase();
  const row = await one(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $3, 1, 1, 0, 0, true) returning id`,
    [lab.storeId, sku, sku],
  );
  const id = String(row.id);
  if (stock > 0) {
    await sql(
      `stock inicial de ${sku}`,
      `insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id)
       values ($1, 'inventario_inicial', $2, $3, $4)`,
      [id, stock, `${TAG} fixture`, lab.storeId],
    );
  }
  return id;
}

const BANK_PAYMENT = `select id from public.register_payment(
  p_sale_id => $1::uuid, p_purchase_id => $2::uuid, p_method => 'transferencia', p_amount => $3::numeric,
  p_bank_name => 'Banco RC16', p_reference_code => $4)`;

/**
 * Una venta de 5 REF cobrada entera por transferencia y una compra recibida de 4 REF con dos pagos por
 * transferencia (2 REF + 1 REF: queda 1 REF pendiente). La venta va primero: su cobro deja en la cuenta del
 * baúl el saldo del que salen los pagos de la compra.
 */
async function fixture(): Promise<Fixture> {
  const productId = await product("p", 10);
  // El cobro bancario de una venta exige una caja abierta de quien cobra: caja propia de lab-admin, fondo 0.
  const register = await one(
    "caja propia",
    "insert into public.cash_registers (store_id, name, is_active) values ($1, $2, true) returning id",
    [lab.storeId, nextTag("caja")],
  );
  await must("abrir la caja", "admin", "select id from public.open_cash_session($1::uuid, 0, 0)", [register.id]);
  const sale = await must(
    "venta",
    "admin",
    `select id, total_ves::float8 as total_ves from public.create_sale(
       p_customer_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_invoice_number => $4)`,
    [lab.customerId, JSON.stringify([{ product_id: productId, quantity: 5, unit_price_ref: 1 }]), rateVes, nextTag("fact")],
  );
  const salePayment = await must("cobro de la venta", "admin", BANK_PAYMENT, [sale.id, null, sale.total_ves, "V-0016"]);

  const item = {
    product_id: productId,
    entry_mode: "unit",
    quantity: 4,
    cost_currency: "ref",
    unit_cost_ref: 1,
    unit_cost_ves: rateVes,
    subtotal_ref: 4,
    subtotal_ves: 4 * rateVes,
    tax_rate: 0,
    tax_ref: 0,
    tax_ves: 0,
  };
  const purchase = await must(
    "compra recibida",
    "almacen",
    `select id from public.create_purchase(
       p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => 0,
       p_tax_ref => 0, p_purchase_number => $4, p_status => 'recibido', p_discount_ves => 0, p_tax_ves => 0,
       p_subtotal_ves => $5::numeric, p_subtotal_ref => 4)`,
    [lab.supplierId, JSON.stringify([item]), rateVes, nextTag("compra"), 4 * rateVes],
  );
  const first = await must("primer pago de la compra", "admin", BANK_PAYMENT, [null, purchase.id, 2 * rateVes, "C-0016"]);
  const second = await must("segundo pago de la compra", "contador", BANK_PAYMENT, [null, purchase.id, rateVes, "C-0017"]);

  return {
    purchaseId: String(purchase.id),
    purchasePaymentIds: [String(first.id), String(second.id)].sort(),
    saleId: String(sale.id),
    salePaymentId: String(salePayment.id),
  };
}

/** Monta el fixture, corre `fn` y lo deshace todo. */
function withFixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  return withRollback(db, async () => fn(await fixture()));
}

async function paymentSnapshot(paymentIds: string[]): Promise<Row[]> {
  return sql(
    "estado de los pagos",
    `select id, status, amount_ves::text as amount_ves, amount_ref::text as amount_ref, notes, bank_name, reference_code,
            purchase_id, sale_id
     from public.payments where id = any($1::uuid[]) order by id`,
    [paymentIds],
  );
}

beforeAll(async () => {
  lab = await Lab.open("rc16");
  db = await lab.pg();
  const rate = await one(
    "tasa vigente",
    "select rate_ves::float8 as rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  rateVes = Number(rate.rate_ves);
  if (!Number.isFinite(rateVes) || rateVes <= 0) throw new Error("SETUP · la tienda lab no tiene tasa de cambio");

  const other = await one(
    `usuario ${OTHER_STORE_ADMIN_EMAIL} de la tienda default`,
    `select u.id from auth.users u join public.profiles p on p.id = u.id
     where u.email = $1 and p.store_id = $2 and p.role = 'admin' and p.is_active`,
    [OTHER_STORE_ADMIN_EMAIL, lab.defaultStoreId],
  );
  otherAdmin = String(other.id);
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261010c · lectura directa de pagos de compras", () => {
  it.each(DENIED)("%s no lee ningún pago de compra: ni por compra, ni por id, ni listando la tienda", async (role) => {
    await withFixture(async (f) => {
      expect(await ids(role, "select id from public.payments where purchase_id = $1", [f.purchaseId])).toEqual([]);
      expect(await ids(role, "select id from public.payments where id = any($1::uuid[])", [f.purchasePaymentIds])).toEqual([]);
      expect(await ids(role, "select id from public.payments where purchase_id is not null")).toEqual([]);
      expect(await ids(role, "select id from public.payments where direction = 'salida'")).toEqual([]);
      // La compra con sus pagos embebidos (lo que PostgREST resuelve con `purchases?select=id,payments(*)`).
      const embedded = await as(
        role,
        `select pu.id, (select count(*)::int from public.payments pa where pa.purchase_id = pu.id) as pagos
         from public.purchases pu where pu.id = $1`,
        [f.purchaseId],
      );
      expect(embedded.rows).toEqual([{ id: f.purchaseId, pagos: 0 }]);
    });
  });

  it.each(ALLOWED)("%s lee los pagos de la compra, como antes del parche", async (role) => {
    await withFixture(async (f) => {
      expect(await ids(role, "select id from public.payments where purchase_id = $1", [f.purchaseId])).toEqual(f.purchasePaymentIds);
      const all = await sql(
        "pagos de compras de la tienda",
        "select id from public.payments where store_id = $1 and purchase_id is not null",
        [lab.storeId],
      );
      expect(await ids(role, "select id from public.payments where purchase_id is not null")).toEqual(
        all.map((row) => String(row.id)).sort(),
      );
    });
  });

  it.each(EVERYONE)("%s sigue leyendo los pagos de ventas de la tienda, todos", async (role) => {
    await withFixture(async (f) => {
      expect(await ids(role, "select id from public.payments where sale_id = $1", [f.saleId])).toEqual([f.salePaymentId]);
      const all = await sql(
        "pagos de ventas de la tienda",
        "select id from public.payments where store_id = $1 and purchase_id is null",
        [lab.storeId],
      );
      expect(await ids(role, "select id from public.payments where purchase_id is null")).toEqual(
        all.map((row) => String(row.id)).sort(),
      );
    });
  });

  it("el admin de OTRA tienda no lee ni los pagos de compras ni los de ventas de esta, y un anónimo no lee payments", async () => {
    await withFixture(async (f) => {
      const mine = [...f.purchasePaymentIds, f.salePaymentId];
      const other = await asUser(otherAdmin, "select id from public.payments where id = any($1::uuid[])", [mine]);
      expect({ code: other.code, rows: other.rows }).toEqual({ code: null, rows: [] });

      const anon = await asUser(null, "select id from public.payments where id = any($1::uuid[])", [mine]);
      expect(anon.rows).toEqual([]);
    });
  });
});

describe("20261010c · la escritura directa de payments sigue prohibida", () => {
  it.each(EVERYONE)("%s no inserta, no borra y no cambia montos ni estado de un pago (42501)", async (role) => {
    await withFixture(async (f) => {
      const all = [...f.purchasePaymentIds, f.salePaymentId];
      const before = await paymentSnapshot(all);

      const insert = await as(
        role,
        `insert into public.payments (store_id, direction, purchase_id, contact_id, method, currency, amount, amount_ves, amount_ref, ref_rate_ves)
         values ($1, 'salida', $2, $3, 'efectivo_ves', 'VES', 100, 100, 1, 100)`,
        [lab.storeId, f.purchaseId, lab.supplierId],
      );
      const remove = await as(role, "delete from public.payments where id = any($1::uuid[])", [all]);
      const amount = await as(role, "update public.payments set amount_ves = 1, amount_ref = 0 where id = any($1::uuid[])", [all]);
      const status = await as(role, "update public.payments set status = 'anulado' where id = any($1::uuid[])", [all]);

      expect([insert.code, remove.code, amount.code, status.code]).toEqual(["42501", "42501", "42501", "42501"]);
      expect(await paymentSnapshot(all)).toEqual(before);
    });
  });

  it.each(DENIED)("%s no cambia la nota de ningún pago: 0 filas, sin error", async (role) => {
    await withFixture(async (f) => {
      const all = [...f.purchasePaymentIds, f.salePaymentId];
      const before = await paymentSnapshot(all);

      const out = await as(role, "update public.payments set notes = 'CAOS RC16' where id = any($1::uuid[]) returning id", [all]);

      expect({ code: out.code, rows: out.rows }).toEqual({ code: null, rows: [] });
      expect(await paymentSnapshot(all)).toEqual(before);
    });
  });

  it.each(ALLOWED)("%s sigue pudiendo corregir la nota de un pago de compra", async (role) => {
    await withFixture(async (f) => {
      const out = await as(role, "update public.payments set notes = 'nota RC16' where purchase_id = $1 returning id", [f.purchaseId]);

      expect(out.code).toBeNull();
      expect(out.rows.map((row) => String(row.id)).sort()).toEqual(f.purchasePaymentIds);
    });
  });
});

describe("20261010c · lo pagado de la compra sigue legible desde su cabecera", () => {
  it.each(["almacen", "admin", "contador"] as const)(
    "%s lee purchases.paid_ref / paid_ves y coinciden con la suma real de los pagos vigentes",
    async (role) => {
      await withFixture(async (f) => {
        const real = await one(
          "suma real de los pagos",
          `select coalesce(sum(amount_ref), 0)::float8 as paid_ref, coalesce(sum(amount_ves), 0)::float8 as paid_ves
           from public.payments where purchase_id = $1 and status <> 'anulado'`,
          [f.purchaseId],
        );
        const header = await as(
          role,
          "select paid_ref::float8 as paid_ref, paid_ves::float8 as paid_ves, total_ref::float8 as total_ref from public.purchases where id = $1",
          [f.purchaseId],
        );

        expect(header.code).toBeNull();
        expect(header.rows).toEqual([{ paid_ref: Number(real.paid_ref), paid_ves: Number(real.paid_ves), total_ref: 4 }]);
        expect(header.rows[0]?.paid_ref).toBe(3);
        expect(header.rows[0]?.paid_ves).toBe(3 * rateVes);
      });
    },
  );

  it("al anular un pago (contador) la cabecera que lee almacén baja con él, sin que almacén lea ningún pago", async () => {
    await withFixture(async (f) => {
      await must("anular el segundo pago", "contador", "select id from public.cancel_payment($1::uuid)", [
        (await one("segundo pago", "select id from public.payments where purchase_id = $1 and amount_ves = $2", [f.purchaseId, rateVes])).id,
      ]);

      const header = await as("almacen", "select paid_ref::float8 as paid_ref, paid_ves::float8 as paid_ves from public.purchases where id = $1", [
        f.purchaseId,
      ]);

      expect(header.rows).toEqual([{ paid_ref: 2, paid_ves: 2 * rateVes }]);
      expect(await ids("almacen", "select id from public.payments where purchase_id = $1", [f.purchaseId])).toEqual([]);
    });
  });
});

describe("20261010c · forma de la política", () => {
  it("payments tiene una sola política de lectura: tienda propia y, para pagos de compra, rol admin o contador", async () => {
    const policies = await sql(
      "políticas de lectura de payments",
      `select policyname, roles::text as roles, qual from pg_policies
       where schemaname = 'public' and tablename = 'payments' and cmd in ('SELECT', 'ALL')`,
    );

    expect(policies).toHaveLength(1);
    expect(policies[0]?.policyname).toBe("Authenticated users read payments");
    expect(policies[0]?.roles).toBe("{authenticated}");
    const qual = String(policies[0]?.qual).toLowerCase();
    expect(qual).toContain("store_id = current_user_store_id()");
    expect(qual).toContain("purchase_id is null");
    expect(qual).toContain("current_user_role()");
    expect(qual).toContain("'admin'");
    expect(qual).toContain("'contador'");
    expect(qual).not.toContain("vendedor");
    expect(qual).not.toContain("almacen");
  });

  it("el parche es idempotente: reaplicarlo deja la misma política", async () => {
    const read = () =>
      sql("política", "select policyname, cmd, roles::text as roles, qual from pg_policies where schemaname = 'public' and tablename = 'payments' order by policyname");
    const before = await read();
    const patch = readFileSync(resolve(process.cwd(), "supabase/patches/20261010c-payments-purchase-rls.sql"), "utf8");

    await db.query(patch);
    await db.query(patch);

    expect(await read()).toEqual(before);
  });
});
