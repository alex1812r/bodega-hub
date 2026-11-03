/** @jest-environment node */
/**
 * REP20-01 · regresión del parche `20261103a-invoice-scan-purchase-permission.sql` (M-p21A-1, D78(a)).
 *
 * Antes: las RPC del escaneo miraban solo el rol (`admin`/`almacen`) mientras el BFF autoriza con los permisos
 * efectivos (rol + `granted_permissions` − `denied_permissions`). Un vendedor o contador con `purchases.create`
 * concedido pasaba la ruta, `reserve_invoice_scan` cobraba la página, el modelo leía la factura y el emparejamiento
 * respondía PT403; y `discard_invoice_scan` no miraba ni el rol ni quién creó el escaneo.
 *
 * Todo corre por `pg` dentro de una transacción con `rollback` (patrón de `invoice-scan-release-deny.test.ts`).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/invoice-scan-purchase-permission.test.ts
 */
import { randomBytes, randomUUID } from "node:crypto";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null };

let lab: Lab;
let db: Client;

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "?";
}

async function attempt(enter: () => Promise<void>, text: string, params: unknown[]): Promise<Outcome> {
  await db.query("savepoint rep20_01_as");
  try {
    await enter();
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint rep20_01_as");
    return { rows: res.rows, code: null };
  } catch (error) {
    await db.query("rollback to savepoint rep20_01_as");
    await db.query("reset role");
    return { rows: [], code: codeOf(error) };
  }
}

const as = (role: LabRoleKey, text: string, params: unknown[] = []) =>
  attempt(() => actAs(db, lab.uids[role]), text, params);

const asServiceRole = (text: string, params: unknown[]) =>
  attempt(async () => {
    await db.query("set local role service_role");
  }, text, params);

async function setExceptions(role: LabRoleKey, granted: string[], denied: string[] = []): Promise<void> {
  await db.query(
    "update public.profiles set granted_permissions = $2::jsonb, denied_permissions = $3::jsonb where id = $1",
    [lab.uids[role], JSON.stringify(granted), JSON.stringify(denied)],
  );
}

/** Escaneo extracted, sin reclamo ni compra, de la tienda lab creado por `owner`. */
async function scan(owner: LabRoleKey): Promise<string> {
  const sha = randomBytes(32).toString("hex");
  const res = await db.query<{ id: string }>(
    `insert into public.invoice_scans (store_id, created_by, image_sha256, storage_path, provider, model, extracted, matched, status)
     values ($1::uuid, $2::uuid, $3::text, $1::text || '/' || $3 || '/p1.jpg', 'mock', 'rep20-01', '{}'::jsonb, '{}'::jsonb, 'extracted')
     returning id`,
    [lab.storeId, lab.uids[owner], sha],
  );
  return res.rows[0].id;
}

async function statusOf(id: string): Promise<string | null> {
  const res = await db.query<{ status: string }>("select status from public.invoice_scans where id = $1", [id]);
  return res.rows[0]?.status ?? null;
}

const MATCH_RPCS: ReadonlyArray<readonly [name: string, sql: string, params: () => unknown[]]> = [
  ["invoice_match_candidates", "select public.invoice_match_candidates($1::text, null, array['harina']::text[]) as r", () => ["Proveedor"]],
  ["invoice_match_exact_aliases", "select public.invoice_match_exact_aliases($1::uuid, array['harina']::text[]) as r", () => [lab.supplierId]],
  ["invoice_match_barcode_products", "select public.invoice_match_barcode_products(array['7590000000000']::text[]) as r", () => []],
  ["invoice_match_previous_scans", "select public.invoice_match_previous_scans($1::text) as r", () => ["F0001"]],
  ["invoice_duplicate_candidates", "select public.invoice_duplicate_candidates($1::text, p_supplier_ids => array[$2::text]) as r", () => ["F0001", lab.supplierId]],
];

const RESERVE = `select public.reserve_invoice_scan($1::uuid, $2::uuid, $3::text, $1::text || '/' || $3 || '/p1.jpg', 1, 10000, 'mock', 'rep20-01') as r`;
const DISCARD = "select id, status from public.discard_invoice_scan_by_user($1::uuid, $2::uuid, $3::uuid)";
const CLAIM = "select public.claim_invoice_scan($1::uuid, $2::uuid) as r";
const RELEASE = "select public.release_invoice_scan_claim($1::uuid, $2::uuid)";
const READ_SCAN = "select s.id from public.invoice_scans s where s.id = $1";

beforeAll(async () => {
  lab = await Lab.open("rep20-01");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261103a · emparejar con purchases.create concedido (M-p21A-1)", () => {
  it.each(MATCH_RPCS)("%s: vendedor y contador con la concesión emparejan como el admin", async (_name, sql, params) => {
    await withRollback(db, async () => {
      await setExceptions("vendedor2", ["purchases.create"]);
      await setExceptions("contador", ["purchases.create"]);

      const admin = await as("admin", sql, params());
      expect(admin.code).toBeNull();
      expect(await as("vendedor2", sql, params())).toEqual(admin);
      expect(await as("contador", sql, params())).toEqual(admin);
    });
  });

  it.each(MATCH_RPCS)("%s: sin la concesión, o con la denegación, PT403", async (_name, sql, params) => {
    await withRollback(db, async () => {
      await setExceptions("almacen", [], ["purchases.create"]);
      // Concedido y denegado a la vez: manda la denegación, como en getEffectivePermissions.
      await setExceptions("contador", ["purchases.create"], ["purchases.create"]);

      expect((await as("vendedor2", sql, params())).code).toBe("PT403");
      expect((await as("almacen", sql, params())).code).toBe("PT403");
      expect((await as("contador", sql, params())).code).toBe("PT403");
    });
  });

  it("el admin ignora la denegación y un perfil inactivo no empareja", async () => {
    await withRollback(db, async () => {
      const [, sql, params] = MATCH_RPCS[0];
      await setExceptions("admin", [], ["purchases.create"]);
      expect((await as("admin", sql, params())).code).toBeNull();

      await setExceptions("vendedor2", ["purchases.create"]);
      await db.query("update public.profiles set is_active = false where id = $1", [lab.uids.vendedor2]);
      // assert_store_context ya rechaza al inactivo (42501); el predicado tampoco lo deja pasar.
      expect((await as("vendedor2", sql, params())).code).not.toBeNull();
      expect((await as("admin", "select public.current_user_can_create_purchase() as r")).rows).toEqual([{ r: true }]);
      expect(
        (await asServiceRole("select public.user_can_create_purchase($1::uuid) as r", [lab.uids.vendedor2])).rows,
      ).toEqual([{ r: false }]);
    });
  });

  it("con la concesión, el vendedor lee el escaneo (reintento en caché) y reclama y suelta como el almacén", async () => {
    await withRollback(db, async () => {
      await setExceptions("vendedor2", ["purchases.create"]);
      const id = await scan("admin");
      const key = randomUUID();

      expect((await as("vendedor2", READ_SCAN, [id])).rows).toEqual([{ id }]);
      expect((await as("vendedor2", CLAIM, [id, key])).rows).toEqual([{ r: "claimed" }]);
      expect((await as("vendedor2", RELEASE, [id, key])).code).toBeNull();

      await setExceptions("vendedor2", []);
      expect((await as("vendedor2", READ_SCAN, [id])).rows).toEqual([]);
      expect((await as("vendedor2", CLAIM, [id, randomUUID()])).code).toBe("PT403");
    });
  });
});

describe("20261103a · reserve_invoice_scan exige el permiso antes de cobrar (M-p21A-1)", () => {
  it("sin purchases.create: PT403, sin fila ni página cobrada", async () => {
    await withRollback(db, async () => {
      const sha = randomBytes(32).toString("hex");

      const out = await asServiceRole(RESERVE, [lab.storeId, lab.uids.vendedor2, sha]);

      expect(out.code).toBe("PT403");
      const rows = await db.query("select 1 from public.invoice_scans where store_id = $1 and image_sha256 = $2", [lab.storeId, sha]);
      expect(rows.rowCount).toBe(0);
    });
  });

  it("con la concesión reserva y cobra como el almacén", async () => {
    await withRollback(db, async () => {
      await setExceptions("vendedor2", ["purchases.create"]);
      const sha = randomBytes(32).toString("hex");

      const out = await asServiceRole(RESERVE, [lab.storeId, lab.uids.vendedor2, sha]);

      expect(out.code).toBeNull();
      expect(out.rows[0]?.r).toMatchObject({ outcome: "reserved" });
    });
  });
});

describe("20261103a · descarte: solo el creador del escaneo o un admin de la tienda (M-p21A-1)", () => {
  it("un vendedor con la concesión no descarta el escaneo del admin (PT403, fila intacta), pero sí el suyo", async () => {
    await withRollback(db, async () => {
      await setExceptions("vendedor2", ["purchases.create"]);
      const adminScan = await scan("admin");
      const ownScan = await scan("vendedor2");

      expect((await asServiceRole(DISCARD, [lab.storeId, adminScan, lab.uids.vendedor2])).code).toBe("PT403");
      expect(await statusOf(adminScan)).toBe("extracted");

      expect((await asServiceRole(DISCARD, [lab.storeId, ownScan, lab.uids.vendedor2])).rows).toEqual([
        { id: ownScan, status: "discarded" },
      ]);
    });
  });

  it("el almacén no descarta el escaneo de otro; el admin descarta el de cualquiera", async () => {
    await withRollback(db, async () => {
      const otherScan = await scan("vendedor2");

      expect((await asServiceRole(DISCARD, [lab.storeId, otherScan, lab.uids.almacen])).code).toBe("PT403");
      expect((await asServiceRole(DISCARD, [lab.storeId, otherScan, lab.uids.admin])).rows).toEqual([
        { id: otherScan, status: "discarded" },
      ]);
    });
  });

  it("el creador que perdió el permiso ya no descarta su escaneo", async () => {
    await withRollback(db, async () => {
      const ownScan = await scan("vendedor2");

      expect((await asServiceRole(DISCARD, [lab.storeId, ownScan, lab.uids.vendedor2])).code).toBe("PT403");
      expect(await statusOf(ownScan)).toBe("extracted");
    });
  });

  it("authenticated no ejecuta el descarte ni el predicado por usuario", async () => {
    await withRollback(db, async () => {
      const id = await scan("admin");
      expect((await as("admin", DISCARD, [lab.storeId, id, lab.uids.admin])).code).toBe("42501");
      expect((await as("admin", "select public.user_can_create_purchase($1::uuid)", [lab.uids.vendedor2])).code).toBe("42501");
    });
  });
});
