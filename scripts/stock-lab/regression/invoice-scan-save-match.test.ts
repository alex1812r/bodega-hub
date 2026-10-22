/** @jest-environment node */
/**
 * REP7-04 · F2 de QA REP7-01: tras un MATCH_ERROR (D35) la fila queda `extracted` con `matched = '{}'` y el
 * reintento en caché re-emparejaba sin guardar (solo `complete_invoice_scan` escribía `matched`, y exige el
 * intento `processing` vigente). `save_invoice_scan_match` (20261019q) guarda SOLO `matched` de un escaneo
 * `extracted` de la tienda: sin tocar estado, páginas cobradas ni lectura. Solo service_role, como 20261019i.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/invoice-scan-save-match.test.ts
 */
import { randomBytes } from "node:crypto";

import { Client } from "pg";

import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;

let lab: Lab;
let db: Client;

const SAVE = "select id, status, usage_pages, matched from public.save_invoice_scan_match($1::uuid, $2::uuid, $3::jsonb)";
const MATCHED = { lines: [], supplier: {}, totals: { computed: 0, mismatch: false } };

/** Escaneo de la tienda lab con `matched = '{}'` (como lo deja un MATCH_ERROR). */
async function scan(status: string): Promise<string> {
  const sha = randomBytes(32).toString("hex");
  const res = await db.query<{ id: string }>(
    `insert into public.invoice_scans (store_id, created_by, image_sha256, storage_path, pages, usage_pages, provider, model, extracted, matched, status)
     values ($1::uuid, $2::uuid, $3::text, $1::text || '/' || $3 || '/p1.jpg', 1, 1, 'mock', 'rep7-04', '{"lines": []}'::jsonb, '{}'::jsonb, $4)
     returning id`,
    [lab.storeId, lab.uids.admin, sha, status],
  );
  return res.rows[0].id;
}

async function asServiceRole(text: string, params: unknown[]): Promise<{ rows: Row[]; code: string | null }> {
  await db.query("savepoint rep7_04_save");
  try {
    await db.query("set local role service_role");
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint rep7_04_save");
    return { rows: res.rows, code: null };
  } catch (error) {
    await db.query("rollback to savepoint rep7_04_save");
    await db.query("reset role");
    return { rows: [], code: String((error as { code?: unknown }).code ?? "?") };
  }
}

beforeAll(async () => {
  lab = await Lab.open("rep7-04-save");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261019q · save_invoice_scan_match (F2)", () => {
  it("guarda solo matched de un escaneo extracted de la tienda, sin cambiar estado ni páginas", async () => {
    await withRollback(db, async () => {
      const id = await scan("extracted");

      const out = await asServiceRole(SAVE, [lab.storeId, id, JSON.stringify(MATCHED)]);

      expect(out.rows).toEqual([{ id, status: "extracted", usage_pages: 1, matched: MATCHED }]);
    });
  });

  it("no toca filas de otra tienda ni escaneos que no estén extracted; rechaza un matched vacío", async () => {
    await withRollback(db, async () => {
      const discarded = await scan("discarded");
      const extracted = await scan("extracted");

      expect((await asServiceRole(SAVE, [lab.storeId, discarded, JSON.stringify(MATCHED)])).rows).toEqual([]);
      expect((await asServiceRole(SAVE, [lab.defaultStoreId, extracted, JSON.stringify(MATCHED)])).rows).toEqual([]);
      expect((await asServiceRole(SAVE, [lab.storeId, extracted, "{}"])).code).toBe("22023");

      const left = await db.query<{ matched: unknown }>("select matched from public.invoice_scans where id = any($1::uuid[])", [
        [discarded, extracted],
      ]);
      expect(left.rows).toEqual([{ matched: {} }, { matched: {} }]);
    });
  });

  it("authenticated (admin de la tienda) no puede ejecutarla", async () => {
    await withRollback(db, async () => {
      const id = await scan("extracted");
      await db.query("savepoint rep7_04_auth");
      await actAs(db, lab.uids.admin);
      const denied = await db.query(SAVE, [lab.storeId, id, JSON.stringify(MATCHED)]).then(
        () => null,
        (error: { code?: string }) => error.code ?? "?",
      );
      await db.query("rollback to savepoint rep7_04_auth");
      await db.query("reset role");

      expect(denied).toBe("42501");
    });
  });
});
