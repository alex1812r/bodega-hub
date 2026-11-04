/** @jest-environment node */
/**
 * REP20-06 · regresión de `20261103a-invoice-scan-purchase-permission.sql` §7 y §8 (QA REP20-05).
 *
 * M-q2005-1: un vendedor o contador con `purchases.create` concedido escanea y empareja, pero `create_purchase`
 * miraba solo el rol (admin | almacen) y respondía PT403 «No autorizado para crear compras»: la factura escaneada
 * (y cobrada) nunca llegaba a compra. Ahora usa el mismo predicado que la app (D78(a)).
 *
 * B-q2005-2: la purga borraba una fila vencida que se está usando hoy (reabierta desde la caché del escaneo, o
 * reclamada para confirmar), porque solo miraba `created_at`. Ahora la reapertura anota `last_used_at` y la lista
 * y el DELETE del cron (`listExpiredScans` / `deleteScansByIds`, por PostgREST) excluyen la actividad reciente.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/invoice-scan-purchase-permission-rep20-06.test.ts
 */
import { randomBytes, randomUUID } from "node:crypto";

import { Client } from "pg";

import { deleteScansByIds, listExpiredScans } from "../../../src/modules/invoice-scan/server/scans.server";
import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string | null };
type AdminClient = Parameters<typeof listExpiredScans>[0];

const TAG = `REP20-06-${Date.now().toString(36)}`;
const RETENTION_DAYS = 90;

let lab: Lab;
let db: Client;
const committedScans: string[] = [];

async function attempt(role: LabRoleKey, text: string, params: unknown[]): Promise<Outcome> {
  await db.query("savepoint rep20_06_as");
  try {
    await actAs(db, lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint rep20_06_as");
    return { rows: res.rows, code: null, message: null };
  } catch (error) {
    await db.query("rollback to savepoint rep20_06_as");
    await db.query("reset role");
    const { code, message } = error as { code?: unknown; message?: unknown };
    return { rows: [], code: typeof code === "string" ? code : "?", message: typeof message === "string" ? message : null };
  }
}

async function setExceptions(role: LabRoleKey, granted: string[], denied: string[] = []): Promise<void> {
  await db.query(
    "update public.profiles set granted_permissions = $2::jsonb, denied_permissions = $3::jsonb where id = $1",
    [lab.uids[role], JSON.stringify(granted), JSON.stringify(denied)],
  );
}

/** Producto activo de la tienda lab (dentro de la transacción del test). */
async function product(): Promise<string> {
  const sku = `${TAG}-${randomUUID().slice(0, 8)}`;
  const res = await db.query<{ id: string }>(
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, lower($2), $2, 9, 1, 0, 0, true) returning id`,
    [lab.storeId, sku],
  );
  return res.rows[0].id;
}

/** Compra recibida de 2 unidades a 1 ref, tasa 100, sin IVA. */
function createPurchase(role: LabRoleKey, productId: string): Promise<Outcome> {
  const items = [
    {
      product_id: productId,
      cost_currency: "ref",
      quantity: 2,
      unit_cost_ref: 1,
      unit_cost_ves: 100,
      subtotal_ref: 2,
      subtotal_ves: 200,
      tax_rate: 0,
      tax_ref: 0,
      tax_ves: 0,
    },
  ];
  return attempt(
    role,
    `select id from public.create_purchase(
       p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => 100, p_discount_ref => 0, p_tax_ref => 0,
       p_notes => $3, p_status => 'recibido', p_discount_ves => 0, p_tax_ves => 0, p_subtotal_ves => 200,
       p_subtotal_ref => 2, p_client_request_id => $4::uuid)`,
    [lab.supplierId, JSON.stringify(items), TAG, randomUUID()],
  );
}

/** Escaneo `extracted` de la tienda lab creado hace 91 días, COMMITEADO (PostgREST no ve la transacción del test). */
async function oldScan(): Promise<{ id: string; sha: string }> {
  const sha = randomBytes(32).toString("hex");
  const res = await lab.db.query<{ id: string }>(
    `insert into public.invoice_scans (store_id, created_by, image_sha256, storage_path, provider, model, extracted, matched, status, created_at)
     values ($1::uuid, $2::uuid, $3::text, $1::text || '/' || $3 || '/p1.jpg', 'mock', $4, '{}'::jsonb, '{}'::jsonb, 'extracted', now() - interval '91 days')
     returning id`,
    [lab.storeId, lab.uids.admin, sha, TAG],
  );
  committedScans.push(res.rows[0].id);
  return { id: res.rows[0].id, sha };
}

async function exists(id: string): Promise<boolean> {
  return (await lab.db.query("select 1 from public.invoice_scans where id = $1", [id])).rowCount === 1;
}

beforeAll(async () => {
  lab = await Lab.open("rep20-06");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) {
    await lab.db.query("delete from public.invoice_scans where id = any($1::uuid[])", [committedScans]);
    await lab.close();
  }
});

describe("20261103a §7 · create_purchase con purchases.create concedido (M-q2005-1)", () => {
  it("vendedor y contador con la concesión registran la compra como el almacén", async () => {
    await withRollback(db, async () => {
      await setExceptions("vendedor2", ["purchases.create"]);
      await setExceptions("contador", ["purchases.create"]);
      const productId = await product();

      for (const role of ["almacen", "vendedor2", "contador"] as const) {
        const out = await createPurchase(role, productId);
        expect({ role, code: out.code, message: out.message }).toEqual({ role, code: null, message: null });
        expect(out.rows).toHaveLength(1);
      }
    });
  });

  it("sin la concesión, con la denegación o el almacén denegado: PT403 con el mismo mensaje; el admin ignora la denegación", async () => {
    await withRollback(db, async () => {
      await setExceptions("almacen", [], ["purchases.create"]);
      await setExceptions("contador", ["purchases.create"], ["purchases.create"]);
      await setExceptions("admin", [], ["purchases.create"]);
      const productId = await product();

      for (const role of ["vendedor2", "almacen", "contador"] as const) {
        expect(await createPurchase(role, productId)).toEqual({
          rows: [],
          code: "PT403",
          message: "No autorizado para crear compras",
        });
      }
      expect((await createPurchase("admin", productId)).code).toBeNull();
    });
  });
});

describe("20261103a §8 · la purga no borra un escaneo vencido en uso (B-q2005-2)", () => {
  const admin = (): AdminClient => lab.service() as unknown as AdminClient;

  it("reabierto hoy desde la caché: no se lista ni se borra; el vencido sin uso, sí", async () => {
    const reopened = await oldScan();
    const idle = await oldScan();

    // El reescaneo de la misma foto, como el BFF (service_role), en su propia transacción commiteada.
    await lab.db.query("begin");
    let reserve: Row | undefined;
    try {
      await lab.db.query("set local role service_role");
      const res = await lab.db.query<Row>(
        "select public.reserve_invoice_scan($1::uuid, $2::uuid, $3::text, $1::text || '/' || $3 || '/p1.jpg', 1, 10000, 'mock', $4) as r",
        [lab.storeId, lab.uids.admin, reopened.sha, TAG],
      );
      reserve = res.rows[0];
      await lab.db.query("commit");
    } catch (error) {
      await lab.db.query("rollback");
      throw error;
    }
    expect(reserve?.r).toEqual({ outcome: "cached", id: reopened.id });

    const now = new Date();
    const listed = await listExpiredScans(admin(), RETENTION_DAYS, now, 100_000);
    expect(listed).toContain(idle.id);
    expect(listed).not.toContain(reopened.id);

    expect(await deleteScansByIds(admin(), [reopened.id, idle.id], RETENTION_DAYS, now)).toBe(1);
    expect(await exists(reopened.id)).toBe(true);
    expect(await exists(idle.id)).toBe(false);
  });

  it("reclamado ahora para confirmar: no se lista ni se borra", async () => {
    const claimed = await oldScan();
    await lab.db.query(
      "update public.invoice_scans set claim_request_id = gen_random_uuid(), claimed_at = now(), claim_started_at = now() where id = $1",
      [claimed.id],
    );

    const now = new Date();
    expect(await listExpiredScans(admin(), RETENTION_DAYS, now, 100_000)).not.toContain(claimed.id);
    expect(await deleteScansByIds(admin(), [claimed.id], RETENTION_DAYS, now)).toBe(0);
    expect(await exists(claimed.id)).toBe(true);
  });
});
