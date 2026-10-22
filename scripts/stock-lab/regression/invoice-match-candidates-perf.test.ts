/** @jest-environment node */
/**
 * REP7-04 · F1 de QA REP7-01: `invoice_match_candidates` (20261019d) comparaba cada texto de la factura con
 * TODOS los productos activos y TODOS los alias del proveedor con `similarity(...) >= 0.6`, que no usa índice:
 * en una tienda de ~1.200 productos, la segunda llamada de una factura de 150 líneas (450 variantes de texto)
 * pasaba del statement_timeout de authenticated (8 s) y el escaneo daba 500 (57014).
 *
 * El parche 20261019q la redefine con el operador `%` (umbral 0,6 fijado en la función) sobre índices GIN
 * trigram (`alias_norm` y `invoice_match_norm(name)`), y conserva `similarity(...) >= 0.6` como filtro: el
 * resultado tiene que ser el mismo que el de la consulta original (aquí, la consulta de 20261019d tal cual).
 *
 * Todo en una transacción con rollback: 1.200 productos y 1.100 alias de un proveedor nuevo en la tienda lab.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/invoice-match-candidates-perf.test.ts
 */
import { performance } from "node:perf_hooks";

import { Client } from "pg";

import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type LineRow = { ordinal: number; product_id: string; score: number | string; via: string };

let lab: Lab;
let db: Client;

const BRANDS = ["Pan", "Mavesa", "Polar", "Nestle", "Kraft", "Primor", "Mary", "Alpina", "Purina", "Colgate",
  "Savoy", "Diablitos", "Toddy", "Juana", "Riko", "Frescolita", "Natulac", "Ricos", "Pampero", "Heinz"];
const ITEMS = ["Harina de maiz blanco", "Margarina con sal", "Malta botella", "Leche en polvo completa",
  "Queso fundido rebanado", "Arroz tipo uno", "Pasta larga spaghetti", "Yogurt de fresa", "Alimento para perro adulto",
  "Crema dental triple accion", "Chocolate de leche", "Jamon endiablado", "Bebida achocolatada", "Mayonesa clasica",
  "Galleta de soda", "Refresco de kolita", "Leche liquida descremada", "Salsa de tomate", "Caraotas negras",
  "Vinagre blanco"];
const SIZES = ["250 gr", "1 kg", "500 ml"];

function productName(index: number): string {
  const brand = BRANDS[index % BRANDS.length];
  const item = ITEMS[Math.floor(index / BRANDS.length) % ITEMS.length];
  const size = SIZES[Math.floor(index / (BRANDS.length * ITEMS.length)) % SIZES.length];
  return `${item} ${brand} ${size}`;
}

const PRODUCTS = 1200;
const ALIASES = 1100;
const LINES = 150;

/** Como normalizeAlias para estos nombres (solo ASCII): minúsculas y no alfanumérico -> un espacio. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Tres variantes por línea, como `searchTextVariants`: la mitad de las líneas son productos de la tienda. */
function variantTexts(): string[] {
  const texts: string[] = [];
  for (let line = 0; line < LINES; line += 1) {
    if (line % 2 === 0) {
      const name = norm(productName((line * 7) % PRODUCTS));
      texts.push(name, `cod ${String(line).padStart(4, "0")} ${name.replace(/ (\d+) /, " $1")} 12 1 234 56`, `${name} bulto x 12`);
    } else {
      const noise = `articulo sin catalogo numero ${line} presentacion ${line % 9} unidades`;
      texts.push(noise, `cgl ${String(line).padStart(4, "0")} ${noise} 3 4 512 33`, `${noise} caja`);
    }
  }
  return texts;
}

/** La consulta de líneas de 20261019d tal cual (fuerza bruta), como referencia del resultado. */
const REFERENCE = `
  with input as (
    select t.ord::integer as ordinal, left(btrim(coalesce(t.txt, '')), 500) as txt,
           left(btrim(coalesce(t.txt, '')), 500) as descr
    from unnest($3::text[]) with ordinality as t(txt, ord)
  ), by_alias as (
    select i.ordinal, a.product_id, similarity(a.alias_norm, i.txt) as score, 'alias'::text as via
    from input i
    join public.supplier_product_aliases a on a.store_id = $1 and a.supplier_id = $2
    join public.products p on p.id = a.product_id and p.store_id = $1
    where i.txt <> '' and similarity(a.alias_norm, i.txt) >= 0.6
  ), by_name as (
    select i.ordinal, p.id as product_id, similarity(public.invoice_match_norm(p.name), i.descr) as score, 'name'::text as via
    from input i
    join public.products p on p.store_id = $1 and p.is_active
    where i.descr <> '' and similarity(public.invoice_match_norm(p.name), i.descr) >= 0.6
  ), best as (
    select distinct on (u.ordinal, u.product_id) u.*
    from (select * from by_alias union all select * from by_name) u
    order by u.ordinal, u.product_id, u.score desc, (u.via = 'alias') desc
  ), top_n as (
    select b.*, row_number() over (partition by b.ordinal order by b.score desc, (b.via = 'alias') desc, b.product_id) as rn
    from best b
  )
  select coalesce(jsonb_agg(jsonb_build_object('ordinal', n.ordinal, 'product_id', n.product_id,
           'score', round(n.score::numeric, 4), 'via', n.via) order by n.ordinal, n.rn), '[]'::jsonb) as lines
  from top_n n
  where n.rn <= 5`;

const RPC = "select public.invoice_match_candidates($1, $2, $3::text[], $3::text[], $4::uuid, 5) as r";

async function seed(): Promise<string> {
  const category = await db.query<{ id: string }>(
    "select id from public.categories where store_id = $1 order by created_at, id limit 1",
    [lab.storeId],
  );
  const supplier = await db.query<{ id: string }>(
    `insert into public.contacts (store_id, type, name, tax_id, is_active)
     values ($1, 'proveedor', $2, 'J-49999123-0', true) returning id`,
    [lab.storeId, `REP7-04 Mayorista ${lab.tag}`],
  );
  const supplierId = supplier.rows[0].id;
  const names = Array.from({ length: PRODUCTS }, (_, index) => productName(index));
  await db.query(
    `insert into public.products (store_id, category_id, sku, name, sale_price_ref, current_cost_ref, is_active)
     select $1, $2, $3 || '-' || lpad(t.ord::text, 4, '0'), t.name, 2, 1, true
     from unnest($4::text[]) with ordinality as t(name, ord)`,
    [lab.storeId, category.rows[0].id, `R704-${lab.tag}`, names],
  );
  await db.query(
    `insert into public.supplier_product_aliases (store_id, supplier_id, product_id, alias_norm, hits)
     select p.store_id, $2, p.id, public.invoice_match_norm(p.name) || ' x 12', 2
     from public.products p
     where p.store_id = $1 and p.sku like $3 || '-%'
     order by p.sku
     limit $4`,
    [lab.storeId, supplierId, `R704-${lab.tag}`, ALIASES],
  );
  // Estadísticas al día, como las deja autoanalyze en una tienda real (los alias crecen
  // de a una factura). Sin esto el planner no conoce al proveedor recién creado, estima
  // 1 alias y los recorre por el btree (store_id, supplier_id). Se revierte con el rollback.
  await db.query("analyze public.products");
  await db.query("analyze public.supplier_product_aliases");
  return supplierId;
}

beforeAll(async () => {
  lab = await Lab.open("rep7-04");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261019q · invoice_match_candidates con una tienda de ~1.200 productos (F1)", () => {
  it("150 líneas con 3 variantes (450 textos) responden en < 3 s con el statement_timeout de authenticated", async () => {
    await withRollback(db, async () => {
      const supplierId = await seed();
      const texts = variantTexts();

      await db.query("savepoint rep7_04_rpc");
      await actAs(db, lab.uids.admin);
      await db.query("set local statement_timeout = '8s'");
      const started = performance.now();
      const res = await db.query<{ r: { lines: LineRow[]; supplier_id: string } }>(RPC, [
        "rep7 04 mayorista",
        "J-49999123-0",
        texts,
        supplierId,
      ]);
      const elapsed = performance.now() - started;
      await db.query("reset role");
      await db.query("release savepoint rep7_04_rpc");

      expect(res.rows[0].r.supplier_id).toBe(supplierId);
      expect(res.rows[0].r.lines.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(3000);
    });
  });

  it("devuelve las mismas líneas que la consulta de 20261019d (alias y nombre, top 5 por texto)", async () => {
    await withRollback(db, async () => {
      const supplierId = await seed();
      // Un tramo de 60 textos: la referencia es fuerza bruta (N x M) y con los 450 tarda demasiado.
      const texts = variantTexts().slice(0, 60);

      const expected = await db.query<{ lines: LineRow[] }>(REFERENCE, [lab.storeId, supplierId, texts]);

      await db.query("savepoint rep7_04_eq");
      await actAs(db, lab.uids.admin);
      const res = await db.query<{ r: { lines: LineRow[] } }>(RPC, ["rep7 04 mayorista", "J-49999123-0", texts, supplierId]);
      await db.query("reset role");
      await db.query("release savepoint rep7_04_eq");

      const lines = res.rows[0].r.lines;
      expect(lines.some((line) => line.via === "alias")).toBe(true);
      expect(lines.some((line) => line.via === "name")).toBe(true);
      expect(lines).toEqual(expected.rows[0].lines);
    });
  });
});
