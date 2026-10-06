/**
 * @jest-environment node
 *
 * STK-519 / F2 — los fixtures del laboratorio siembran por el camino válido del
 * libro mayor (parches 20261006a + 20261006e).
 *
 * Evidencia: `.notes/stock-integrity-gtm/qa/STK-513/verdict.md` (F2,
 * `06-fixture-doubling-repro.sql`): `seedProducts` insertaba el producto con
 * `current_stock = N` Y el movimiento `inventario_inicial` +N. Desde 20261006e
 * el trigger `stock_movements_apply()` IGNORA el `stock_after` del llamador y
 * aplica siempre el delta → `current_stock = 2N`, libro `N`: 19/19 casos de
 * caos en `fail` y 392 filas en `stock_reconciliation`.
 *
 * Sin base: el doble `FakeLedgerDb` reproduce esas dos reglas del trigger
 * (el alta de producto respeta el `current_stock` enviado por `postgres`; cada
 * movimiento insertado suma su delta al producto).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { Client } from "pg";

import { type Lab, cleanupOwnProducts, formatCleanup, ownSkuPattern, seedProducts } from "./chaos/cases";

type Call = { text: string; params: unknown[] };

/** Columnas de `insert into public.<tabla> (…)`. */
function insertColumns(text: string, table: string): string[] | null {
  const match = new RegExp(`insert\\s+into\\s+public\\.${table}\\s*\\(([^)]*)\\)`, "i").exec(text);
  return match ? (match[1] ?? "").split(",").map((column) => column.trim().toLowerCase()) : null;
}

class FakeLedgerDb {
  readonly calls: Call[] = [];
  /** id → current_stock, tal como lo dejaría el trigger. */
  readonly stock = new Map<string, number>();
  readonly ledger = new Map<string, number>();

  constructor(private readonly seededStock: number) {}

  async query(text: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    this.calls.push({ text, params });
    const productColumns = insertColumns(text, "products");
    if (productColumns) {
      const skus = (params.find((param) => Array.isArray(param)) as string[] | undefined) ?? [];
      // Alta por `postgres`: el guard deja pasar el current_stock que se envíe.
      const sendsStock = productColumns.includes("current_stock") && params.includes(this.seededStock);
      const rows = skus.map((sku, index) => ({ id: `id-${index + 1}`, sku }));
      for (const row of rows) {
        this.stock.set(row.id, sendsStock ? this.seededStock : 0);
        this.ledger.set(row.id, 0);
      }
      return { rows, rowCount: rows.length };
    }
    if (insertColumns(text, "stock_movements")) {
      const ids = (params.find((param) => Array.isArray(param)) as string[] | undefined) ?? [];
      const delta = params.find((param) => typeof param === "number") as number;
      // stock_movements_apply(): stock_after := current_stock + delta, y lo escribe en products.
      for (const id of ids) {
        this.stock.set(id, (this.stock.get(id) ?? 0) + delta);
        this.ledger.set(id, (this.ledger.get(id) ?? 0) + delta);
      }
      return { rows: [], rowCount: ids.length };
    }
    return { rows: [], rowCount: 0 };
  }
}

function fakeLab(db: FakeLedgerDb): Lab {
  return {
    runId: "qa5",
    nonce: "abc12",
    storeId: "store-lab",
    supabaseUrl: "http://127.0.0.1:14321",
    anonKey: "anon",
    dbUrl: "postgres://lab",
    db: db as unknown as Client,
    userIds: { admin: "u-admin", vendedor1: "u-v1", vendedor2: "u-v2", almacen: "u-alm", contador: "u-cont" },
    customerId: "c",
    supplierId: "s",
    sessions: new Map(),
    tokens: new Map(),
    extraDbs: [],
  };
}

describe("STK-519 · chaos seedProducts siembra por el libro mayor", () => {
  it("cada producto nace con current_stock = N = Σ movimientos (no 2N)", async () => {
    const db = new FakeLedgerDb(37);
    const products = await seedProducts(fakeLab(db), "9.1-r1", 3, { stock: 37 });

    expect(products.map((p) => p.sku)).toEqual(["C411-qa5-abc12-9.1-r1-01", "C411-qa5-abc12-9.1-r1-02", "C411-qa5-abc12-9.1-r1-03"]);
    expect(products.every((p) => p.stock === 37)).toBe(true);
    expect([...db.stock.values()]).toEqual([37, 37, 37]);
    expect([...db.ledger.values()]).toEqual([37, 37, 37]);
  });

  it("el producto se inserta con stock 0 y el movimiento inventario_inicial no fija stock_after", async () => {
    const db = new FakeLedgerDb(37);
    await seedProducts(fakeLab(db), "t", 2, { stock: 37 });

    const product = db.calls.find((call) => insertColumns(call.text, "products"));
    const movement = db.calls.find((call) => insertColumns(call.text, "stock_movements"));
    expect(product?.params).not.toContain(37);
    expect(insertColumns(movement?.text ?? "", "stock_movements")).not.toContain("stock_after");
    expect(movement?.text).toMatch(/inventario_inicial/);
    expect(movement?.params).toContain(37);
    expect(db.calls.map((call) => call.text.trim())).toEqual(expect.arrayContaining(["begin", "commit"]));
  });

  it("con stock 0 no inserta movimiento", async () => {
    const db = new FakeLedgerDb(0);
    await seedProducts(fakeLab(db), "t", 1, { stock: 0 });
    expect(db.calls.some((call) => insertColumns(call.text, "stock_movements"))).toBe(false);
  });
});

describe("STK-519 · el runner de caos limpia sus productos C411-<run>-<nonce>-…", () => {
  /** Doble de pg para la limpieza: `intact` = ids que devuelve el select de productos intactos. */
  function cleanupDb(intact: string[], failOn?: RegExp) {
    const calls: Call[] = [];
    const query = async (text: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
      if (failOn?.test(text)) throw new Error("violates foreign key constraint");
      if (/^\s*select p\.id from public\.products/i.test(text)) return { rows: intact.map((id) => ({ id })), rowCount: intact.length };
      if (/^\s*delete from public\.products/i.test(text)) return { rows: [], rowCount: intact.length };
      if (/^\s*update public\.products/i.test(text)) return { rows: [], rowCount: 4 };
      return { rows: [], rowCount: 0 };
    };
    return { calls, lab: { ...fakeLab(new FakeLedgerDb(0)), db: { query } as unknown as Client } };
  }

  it("ownSkuPattern acota al run y al proceso, escapando los comodines de LIKE", () => {
    expect(ownSkuPattern({ runId: "qa5", nonce: "abc12" })).toBe("C411-qa5-abc12-%");
    expect(ownSkuPattern({ runId: "qa_5%", nonce: "abc12" })).toBe("C411-qa\\_5\\%-abc12-%");
  });

  it("borra los intactos (movimiento + producto) y desactiva el resto, en una transacción y solo con su prefijo", async () => {
    const { calls, lab } = cleanupDb(["id-1", "id-2"]);
    const result = await cleanupOwnProducts(lab);
    const texts = calls.map((call) => call.text);

    expect(result).toEqual({ deleted: 2, deactivated: 4, error: null });
    expect(texts[0]).toBe("begin");
    expect(texts[texts.length - 1]).toBe("commit");
    // Intacto = solo inventario_inicial, sin líneas de venta/compra y con current_stock = libro.
    expect(texts[1]).toMatch(/m\.type <> 'inventario_inicial'/);
    expect(texts[1]).toMatch(/public\.sale_items/);
    expect(texts[1]).toMatch(/public\.purchase_items/);
    expect(texts[1]).toMatch(/p\.current_stock = \(select coalesce\(sum\(m\.quantity_delta\), 0\)/);
    expect(calls[1]?.params).toEqual(["store-lab", "C411-qa5-abc12-%"]);
    expect(calls[2]).toEqual({ text: "delete from public.stock_movements where product_id = any($1::uuid[])", params: [["id-1", "id-2"]] });
    expect(calls[3]).toEqual({ text: "delete from public.products where id = any($1::uuid[])", params: [["id-1", "id-2"]] });
    expect(texts[4]).toMatch(/^update public\.products p set is_active = false where p\.store_id = \$1::uuid and p\.sku like \$2 escape/);
    expect(calls[4]?.params).toEqual(["store-lab", "C411-qa5-abc12-%"]);
    // Nunca escribe current_stock ni borra documentos (ventas, compras, pagos: son la evidencia del run).
    expect(texts.join("\n")).not.toMatch(/set current_stock|delete from public\.(sales|purchases|payments|sale_items|purchase_items)/i);
  });

  it("sin productos intactos no borra nada", async () => {
    const { calls, lab } = cleanupDb([]);
    expect(await cleanupOwnProducts(lab)).toEqual({ deleted: 0, deactivated: 4, error: null });
    expect(calls.some((call) => /^delete/i.test(call.text))).toBe(false);
  });

  it("si la base falla hace rollback y devuelve el error sin lanzar (no cambia el veredicto del run)", async () => {
    const { calls, lab } = cleanupDb(["id-1"], /delete from public\.products/i);
    const result = await cleanupOwnProducts(lab);
    expect(result).toMatchObject({ deleted: 0, deactivated: 0 });
    expect(result.error).toMatch(/foreign key/);
    expect(calls[calls.length - 1]?.text).toBe("rollback");
    expect(formatCleanup(result)).toMatch(/FALLÓ/);
  });
});

// ---------------------------------------------------------------------------
// Guardia transversal: ningún script del lab vuelve al patrón de F2
// ---------------------------------------------------------------------------

const LAB_DIR = resolve(__dirname);

function labSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // `regression/**` prueba a propósito que el trigger ignora un stock_after inventado; `runs/` son salidas.
      if (["regression", "runs", "__fixtures__", "node_modules"].includes(name)) continue;
      out.push(...labSources(full));
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

describe("STK-519 · ningún script del lab escribe el libro por fuera del trigger", () => {
  const sources = labSources(LAB_DIR).map((file) => ({ file: relative(LAB_DIR, file).replace(/\\/g, "/"), text: readFileSync(file, "utf8") }));

  it("recorre los scripts del lab", () => {
    expect(sources.map((source) => source.file)).toEqual(
      expect.arrayContaining(["chaos/cases.ts", "scenarios/db.ts", "scenarios/hypotheses.ts", "scenarios/oneshots.ts", "seed-lab.ts"]),
    );
  });

  it("ningún insert SQL en stock_movements nombra la columna stock_after (la fija el trigger)", () => {
    const offenders = sources.filter((source) => /insert\s+into\s+public\.stock_movements\s*\([^)]*stock_after/i.test(source.text)).map((source) => source.file);
    expect(offenders).toEqual([]);
  });

  it("ninguna sentencia inserta un movimiento y además hace update de current_stock (lo duplicaría)", () => {
    const offenders: string[] = [];
    for (const source of sources) {
      // Cada literal de plantilla / cadena SQL que inserta en stock_movements.
      for (const match of source.text.matchAll(/`[^`]*insert\s+into\s+public\.stock_movements[^`]*`/gi)) {
        if (/update\s+public\.products\b[^`]*\bset\s+current_stock/i.test(match[0])) offenders.push(source.file);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("todo alta SQL de producto nace con current_stock 0 (el stock entra con inventario_inicial)", () => {
    const offenders: string[] = [];
    for (const source of sources) {
      for (const match of source.text.matchAll(/insert\s+into\s+public\.products\s*\(([^)]*)\)\s*(values\s*\(([^)]*)\)|select\s+([^`]*?)\s+from\b)/gi)) {
        const columns = (match[1] ?? "").split(",").map((column) => column.trim());
        const index = columns.indexOf("current_stock");
        if (index === -1) continue;
        const values = (match[3] ?? match[4] ?? "").split(",").map((value) => value.trim());
        if (values[index] !== "0") offenders.push(`${source.file}: current_stock = ${values[index] ?? "?"}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("las lecturas de la cadena por producto ordenan por seq, no por created_at", () => {
    const offenders = sources
      .filter((source) => /from\s+public\.stock_movements\b[^`"]*order\s+by\s+created_at/i.test(source.text))
      .map((source) => source.file);
    // oneshots.ts conserva el `order by created_at` de la réplica literal del parche 20260830b-remove (un UPDATE, no una lectura).
    expect(offenders.filter((file) => file !== "scenarios/oneshots.ts")).toEqual([]);
  });
});
