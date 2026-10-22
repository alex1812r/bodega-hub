/** @jest-environment node */
/**
 * REP4-02b · regresión del parche `20261019o-invoice-scan-release-deny.sql` (auditoría p5 B19, resto de B17-ext).
 *
 * Antes: `release_invoice_scan_claim` solo miraba el rol, así que un almacén con `purchases.create` en
 * `denied_permissions` (que no puede reclamar, comprar ni descartar) leía por PostgREST la clave del reclamo en
 * curso de otro usuario (`invoice_scans.claim_request_id`, visible por la RLS de lectura) y lo soltaba (204).
 *
 * Todo corre por `pg` dentro de una transacción con `rollback` (patrón de `payments-purchase-rls.test.ts`): cada
 * sentencia probada va con `set local role authenticated` + `request.jwt.claims`, igual que PostgREST.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/invoice-scan-release-deny.test.ts
 */
import { randomBytes, randomUUID } from "node:crypto";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };

let lab: Lab;
let db: Client;

function failure(error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown }).code;
  return { code: typeof code === "string" ? code : "?", message: error instanceof Error ? error.message : String(error) };
}

async function as(role: LabRoleKey, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint rep4_02b_as");
  try {
    await actAs(db, lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint rep4_02b_as");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint rep4_02b_as");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

async function deny(role: LabRoleKey, denied: boolean): Promise<void> {
  await db.query("update public.profiles set denied_permissions = $2::jsonb where id = $1", [
    lab.uids[role],
    JSON.stringify(denied ? ["purchases.create"] : []),
  ]);
}

/** Escaneo extracted, sin reclamo ni compra, de la tienda lab. */
async function scan(): Promise<string> {
  const sha = randomBytes(32).toString("hex");
  const res = await db.query<{ id: string }>(
    `insert into public.invoice_scans (store_id, created_by, image_sha256, storage_path, provider, model, extracted, matched, status)
     values ($1::uuid, $2::uuid, $3::text, $1::text || '/' || $3 || '/p1.jpg', 'mock', 'rep4-02b', '{}'::jsonb, '{}'::jsonb, 'extracted')
     returning id`,
    [lab.storeId, lab.uids.admin, sha],
  );
  return res.rows[0].id;
}

async function claimOf(id: string): Promise<string | null> {
  const res = await db.query<{ claim_request_id: string | null }>(
    "select claim_request_id from public.invoice_scans where id = $1",
    [id],
  );
  return res.rows[0]?.claim_request_id ?? null;
}

const CLAIM = "select public.claim_invoice_scan($1::uuid, $2::uuid) as r";
const RELEASE = "select public.release_invoice_scan_claim($1::uuid, $2::uuid)";

beforeAll(async () => {
  lab = await Lab.open("rep4-02b");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261019o · release con la denegación de purchases.create (B19)", () => {
  it("un almacén con purchases.create denegado no suelta el reclamo en curso de otro (PT403, fila intacta)", async () => {
    await withRollback(db, async () => {
      const id = await scan();
      const key = randomUUID();
      expect((await as("admin", CLAIM, [id, key])).rows).toEqual([{ r: "claimed" }]);
      await deny("almacen", true);

      const out = await as("almacen", RELEASE, [id, key]);
      expect(out.code).toBe("PT403");
      expect(await claimOf(id)).toBe(key);
    });
  });

  it("claim y release legítimos siguen funcionando: almacén sin denegación y admin con o sin denegación", async () => {
    await withRollback(db, async () => {
      const id = await scan();
      const k1 = randomUUID();
      expect((await as("almacen", CLAIM, [id, k1])).rows).toEqual([{ r: "claimed" }]);
      expect((await as("almacen", RELEASE, [id, k1])).code).toBeNull();
      expect(await claimOf(id)).toBeNull();

      // El admin ignora las excepciones por usuario (getEffectivePermissions), igual que en claim.
      await deny("admin", true);
      const k2 = randomUUID();
      expect((await as("admin", CLAIM, [id, k2])).rows).toEqual([{ r: "claimed" }]);
      expect((await as("admin", RELEASE, [id, k2])).code).toBeNull();
      expect(await claimOf(id)).toBeNull();
    });
  });

  it("contador y vendedor siguen en PT403", async () => {
    await withRollback(db, async () => {
      const id = await scan();
      const key = randomUUID();
      expect((await as("admin", CLAIM, [id, key])).rows).toEqual([{ r: "claimed" }]);
      expect((await as("contador", RELEASE, [id, key])).code).toBe("PT403");
      expect((await as("vendedor1", RELEASE, [id, key])).code).toBe("PT403");
      expect(await claimOf(id)).toBe(key);
    });
  });
});

describe("20261019o · la clave del reclamo no se lee por PostgREST (B19)", () => {
  it.each<LabRoleKey>(["almacen", "contador", "admin"])("%s no lee claim_request_id (42501)", async (role) => {
    await withRollback(db, async () => {
      const id = await scan();
      expect((await as("admin", CLAIM, [id, randomUUID()])).rows).toEqual([{ r: "claimed" }]);
      const out = await as(role, "select claim_request_id from public.invoice_scans where id = $1", [id]);
      expect(out.code).toBe("42501");
    });
  });

  it.each<LabRoleKey>(["almacen", "contador", "admin"])("%s sigue leyendo las columnas que usa el BFF", async (role) => {
    await withRollback(db, async () => {
      const id = await scan();
      const out = await as(
        role,
        `select s.id, s.store_id, s.created_by, s.image_sha256, s.storage_path, s.pages, s.usage_pages, s.provider,
                s.model, s.input_tokens, s.output_tokens, s.duration_ms, s.extracted, s.matched, s.confirmed,
                s.purchase_id, s.supplier_id, s.status, s.error, s.created_at, s.confirmed_at, s.learned_at,
                s.claimed_at, s.claim_started_at, s.attempt_id
         from public.invoice_scans s where s.id = $1`,
        [id],
      );
      expect({ code: out.code, rows: out.rows.length }).toEqual({ code: null, rows: 1 });
    });
  });
});
