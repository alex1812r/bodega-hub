/**
 * Seed del escenario "Bodega Banco Facturas (eval)" en la base LAB local
 * (SCN-10f; plan factura-escaneo-gtm §5.4 SCN-10).
 *
 *   npx tsx scripts/invoice-eval/seed-lab.ts
 *
 * Idempotente: borra y recrea TODO lo de `stores.slug = 'eval-facturas'` (y su
 * usuario), así que dos corridas seguidas dejan el mismo estado sin duplicados.
 * Toma `.notes/factura-escaneo/lab.lock` antes de escribir (espera hasta 15 min
 * si otro lo tiene; uno de más de 30 min se da por abandonado) y lo libera al final.
 * No toca ninguna otra tienda. Solo lee `.env.stock-lab` y aborta si la API o
 * la base no son 127.0.0.1 / localhost (guard de stock-lab + chequeo propio).
 *
 * Siembra (catálogo en `scenario/catalog.ts`, compras/tasas en `scenario/plan.ts`):
 * - tienda + app_settings (alícuota por defecto: general 16 %) + 1 usuario admin;
 * - categorías con alícuota (víveres exentos, el resto general 16 %);
 * - productos del catálogo (los `inCatalog: false` NO se crean) y el producto
 *   empaque de la receta (product_pack_conversions; el trigger crea el componente);
 * - proveedores (+ "Compras varias (histórico)"), vínculos supplier_products con
 *   supplier_sku / is_preferred y algunos supplier_product_pack_units;
 * - exchange_rates: las tasas impresas en las facturas reales, la última = la del día;
 * - compras históricas por el camino real: login del admin (anon key) + RPC
 *   `create_purchase` recibida (mueve stock y deja el libro cuadrado), luego se
 *   fecha `purchases.created_at` al día de la factura de origen. El último costo
 *   que lee `loadMatchContext` sale de esas `purchase_items.unit_cost_ref`.
 * - supplier_product_aliases: NINGUNO (el runner los simula en memoria).
 *
 * `loadScenarioIds(client)` da al runner los ids (productKey -> products.id solo
 * de las en catálogo; supplierKey -> contacts.id). La RPC de candidatos exige
 * sesión con perfil activo: el runner debe iniciar sesión con
 * SCENARIO_USER_EMAIL / SCENARIO_USER_PASSWORD (un cliente service-role da 42501).
 */
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { loadStockLabEnv } from "../stock-lab/env";
import { STORE_SCOPED_DELETE_ORDER, assertSeedEnv, type SeedEnv } from "../stock-lab/seed-lab";

import {
  HISTORY_SUPPLIER,
  SCENARIO_CATEGORIES,
  SCENARIO_PRODUCTS,
  SCENARIO_RECIPES,
  SCENARIO_STORE_NAME,
  SCENARIO_STORE_SLUG,
  SCENARIO_SUPPLIERS,
  SCENARIO_USER_EMAIL,
  SCENARIO_USER_NAME,
  SCENARIO_USER_PASSWORD,
  scenarioSku,
} from "./scenario/catalog";
import { LAB_LOCK_PATH, releaseLabLock } from "./run";
import { plannedExchangeRates, plannedPurchases, productCostSources, type PlannedPurchase } from "./scenario/plan";
import { loadTruth, type InvoiceTruth } from "./truth";

const ROOT = resolve(__dirname, "../..");
const TRUTH_DIR = resolve(__dirname, "truth");
/** Margen de venta sembrado sobre el último costo (solo para que el producto tenga precio). */
const SEED_MARKUP = 1.3;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Hora del día operativo de Caracas (UTC-4) para fechar filas históricas. */
function caracasNoon(date: string): string {
  return `${date}T12:00:00-04:00`;
}

// ---------------------------------------------------------------------------
// Guard de entorno
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Aborta (sin conectar) si la API o la base no son locales. Además valida con el guard de stock-lab. */
export function assertScenarioEnv(env: Record<string, string | undefined>): SeedEnv {
  const seedEnv = assertSeedEnv(env);
  for (const [label, value] of [
    ["NEXT_PUBLIC_SUPABASE_URL", seedEnv.supabaseUrl],
    ["STOCK_LAB_DB_URL", seedEnv.dbUrl],
  ] as const) {
    let host: string;
    try {
      host = new URL(value).hostname;
    } catch {
      throw new Error(`${label} no es una URL válida`);
    }
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`${label} apunta a "${host}": el seed del banco solo escribe en 127.0.0.1 / localhost`);
    }
  }
  return seedEnv;
}

// ---------------------------------------------------------------------------
// Limpieza (solo la tienda del escenario)
// ---------------------------------------------------------------------------

async function storeScopedTables(db: Client): Promise<string[]> {
  const result = await db.query<{ table_name: string }>(
    `select c.table_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'store_id' and t.table_type = 'BASE TABLE'
        and c.table_name <> 'stores'
      order by 1`,
  );
  return result.rows.map((row) => row.table_name);
}

async function wipeScenarioStore(db: Client, admin: SupabaseClient, storeId: string): Promise<void> {
  const tables = await storeScopedTables(db);
  const unknown = tables.filter((table) => !STORE_SCOPED_DELETE_ORDER.includes(table));
  const order = [...unknown, ...STORE_SCOPED_DELETE_ORDER.filter((table) => tables.includes(table))];

  const users = await db.query<{ id: string }>(
    `select u.id from auth.users u
      where u.id in (select id from public.profiles where store_id = $1) or u.email = $2`,
    [storeId, SCENARIO_USER_EMAIL],
  );
  const otherStore = await db.query<{ n: string }>(
    `select count(*)::text as n from public.profiles where id = any($1::uuid[]) and store_id <> $2`,
    [users.rows.map((row) => row.id), storeId],
  );
  if (Number(otherStore.rows[0].n) > 0) {
    throw new Error(`${SCENARIO_USER_EMAIL} pertenece a otra tienda: no se borra`);
  }

  await db.query("begin");
  try {
    for (const table of order) {
      try {
        await db.query(`delete from public.${table} where store_id = $1`, [storeId]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`No se pudo limpiar public.${table} de ${SCENARIO_STORE_SLUG}: ${message}`);
      }
    }
    await db.query("delete from public.stores where id = $1", [storeId]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }

  for (const user of users.rows) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`auth.admin.deleteUser(${user.id}): ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

async function createStore(db: Client): Promise<string> {
  const store = await db.query<{ id: string }>(
    `insert into public.stores (name, slug, status, notes)
     values ($1, $2, 'active', 'Escenario del banco de facturas (scripts/invoice-eval/seed-lab.ts). Solo local.')
     returning id`,
    [SCENARIO_STORE_NAME, SCENARIO_STORE_SLUG],
  );
  const storeId = store.rows[0].id;
  await db.query(
    `insert into public.app_settings (id, business_name, default_tax_rate, default_tax_rate_id, invoice_prefix, low_stock_threshold, store_id)
     values (1, $1, 16, (select id from public.tax_rates where store_id is null and code = 'general'), 'FAC', 5, $2)`,
    [SCENARIO_STORE_NAME, storeId],
  );
  return storeId;
}

async function createUser(db: Client, admin: SupabaseClient, storeId: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: SCENARIO_USER_EMAIL,
    password: SCENARIO_USER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: SCENARIO_USER_NAME, role: "admin", store_id: storeId },
  });
  if (error || !data.user) {
    throw new Error(`auth.admin.createUser(${SCENARIO_USER_EMAIL}): ${error?.message ?? "sin usuario"}`);
  }
  await db.query(
    `insert into public.profiles (id, full_name, role, store_id, is_active)
     values ($1, $2, 'admin'::public.user_role, $3, true)
     on conflict (id) do update
       set full_name = excluded.full_name, role = excluded.role, store_id = excluded.store_id, is_active = true`,
    [data.user.id, SCENARIO_USER_NAME, storeId],
  );
  return data.user.id;
}

type CatalogIds = {
  products: Record<string, string>;
  suppliers: Record<string, string>;
  historySupplierId: string;
};

async function createCatalog(db: Client, storeId: string, truths: readonly InvoiceTruth[]): Promise<CatalogIds> {
  const categoryIds: Record<string, string> = {};
  for (const category of SCENARIO_CATEGORIES) {
    const result = await db.query<{ id: string; code: string | null }>(
      `with c as (
         insert into public.categories (store_id, name, tax_rate, is_active) values ($1, $2, $3, true)
         returning id, tax_rate_id)
       select c.id, t.code from c left join public.tax_rates t on t.id = c.tax_rate_id`,
      [storeId, category.name, category.pct],
    );
    if (result.rows[0].code !== category.taxCode) {
      throw new Error(`La categoría ${category.name} quedó con alícuota ${result.rows[0].code}, se esperaba ${category.taxCode}`);
    }
    categoryIds[category.key] = result.rows[0].id;
  }

  const costs = new Map(productCostSources(truths).map((source) => [source.productKey, source.unitCostRef]));
  const products: Record<string, string> = {};
  for (const [index, product] of SCENARIO_PRODUCTS.entries()) {
    if (!product.inCatalog) continue;
    const cost = costs.get(product.key) ?? 0;
    const result = await db.query<{ id: string }>(
      `insert into public.products (store_id, category_id, sku, barcode, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       values ($1, $2, $3, $4, $5, $6, 0, 0, 5, true) returning id`,
      [storeId, categoryIds[product.categoryKey], scenarioSku(index), product.barcode ?? null, product.name, round2(cost * SEED_MARKUP)],
    );
    products[product.key] = result.rows[0].id;
  }

  for (const recipe of SCENARIO_RECIPES) {
    const unit = SCENARIO_PRODUCTS.find((product) => product.key === recipe.unitKey);
    const unitCost = costs.get(recipe.unitKey) ?? 0;
    const pack = await db.query<{ id: string }>(
      `insert into public.products (store_id, category_id, sku, barcode, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       values ($1, $2, $3, null, $4, $5, 0, 0, 0, true) returning id`,
      [storeId, categoryIds[unit?.categoryKey ?? ""], recipe.packSku, recipe.packName, round2(unitCost * recipe.unitsPerPack * SEED_MARKUP)],
    );
    await db.query(
      `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, total_units, label, is_active)
       values ($1, $2, $3, $4, $4, $5, true)`,
      [storeId, pack.rows[0].id, products[recipe.unitKey], recipe.unitsPerPack, `Bulto x${recipe.unitsPerPack}`],
    );
  }

  const suppliers: Record<string, string> = {};
  for (const supplier of SCENARIO_SUPPLIERS) {
    const contact = await db.query<{ id: string }>(
      `insert into public.contacts (store_id, type, name, tax_id, is_active) values ($1, 'proveedor', $2, $3, true) returning id`,
      [storeId, supplier.name, supplier.taxId],
    );
    suppliers[supplier.key] = contact.rows[0].id;
  }
  const history = await db.query<{ id: string }>(
    `insert into public.contacts (store_id, type, name, tax_id, notes, is_active) values ($1, 'proveedor', $2, $3, 'Compras históricas del escenario', true) returning id`,
    [storeId, HISTORY_SUPPLIER.name, HISTORY_SUPPLIER.taxId],
  );

  for (const supplier of SCENARIO_SUPPLIERS) {
    for (const link of supplier.links) {
      const sp = await db.query<{ id: string }>(
        `insert into public.supplier_products (store_id, supplier_id, product_id, supplier_sku, is_preferred, is_active)
         values ($1, $2, $3, $4, $5, true) returning id`,
        [storeId, suppliers[supplier.key], products[link.productKey], link.supplierSku ?? null, link.isPreferred === true],
      );
      if (link.packUnit) {
        await db.query(
          `insert into public.supplier_product_pack_units (supplier_product_id, label, units_per_pack, is_default, is_active)
           values ($1, $2, $3, true, true)`,
          [sp.rows[0].id, link.packUnit.label, link.packUnit.unitsPerPack],
        );
      }
    }
  }

  return { products, suppliers, historySupplierId: history.rows[0].id };
}

async function createExchangeRates(db: Client, storeId: string, userId: string, truths: readonly InvoiceTruth[]): Promise<void> {
  for (const point of plannedExchangeRates(truths)) {
    await db.query(
      `insert into public.exchange_rates (store_id, rate_ves, source, notes, created_by, created_at)
       values ($1, $2, 'Manual', 'seed invoice-eval (tasa impresa en factura)', $3, $4)`,
      [storeId, point.rate, userId, caracasNoon(point.date)],
    );
  }
}

function purchaseItems(purchase: PlannedPurchase, products: Record<string, string>): Array<Record<string, unknown>> {
  return purchase.lines.map((line) => {
    const subtotalRef = round2(line.quantity * line.unitCostRef);
    const subtotalVes = round2(line.quantity * line.unitCostVes);
    return {
      product_id: products[line.productKey],
      entry_mode: "unit",
      quantity: line.quantity,
      cost_currency: "ves",
      unit_cost_ref: line.unitCostRef,
      unit_cost_ves: line.unitCostVes,
      subtotal_ref: subtotalRef,
      subtotal_ves: subtotalVes,
      tax_rate: line.taxPct,
      tax_rate_code: line.taxCode,
      tax_ref: round2((subtotalRef * line.taxPct) / 100),
      tax_ves: round2((subtotalVes * line.taxPct) / 100),
    };
  });
}

/** Compras recibidas por el camino real (RPC create_purchase con sesión del admin). */
async function createPurchases(
  env: SeedEnv,
  db: Client,
  storeId: string,
  ids: CatalogIds,
  truths: readonly InvoiceTruth[],
): Promise<number> {
  const client = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await client.auth.signInWithPassword({ email: SCENARIO_USER_EMAIL, password: SCENARIO_USER_PASSWORD });
  if (loginError) throw new Error(`signInWithPassword(${SCENARIO_USER_EMAIL}): ${loginError.message}`);

  const purchases = plannedPurchases(truths);
  try {
    for (const purchase of purchases) {
      const items = purchaseItems(purchase, ids.products);
      const sum = (key: string) => round2(items.reduce((total, item) => total + Number(item[key]), 0));
      const supplierId = purchase.supplierKey ? ids.suppliers[purchase.supplierKey] : ids.historySupplierId;
      const { data, error } = await client.rpc("create_purchase", {
        p_supplier_id: supplierId,
        p_items: items,
        p_ref_rate_ves: purchase.rate,
        p_discount_ref: 0,
        p_tax_ref: sum("tax_ref"),
        p_notes: `Compra histórica del escenario (${purchase.supplierName})`,
        p_purchase_number: purchase.number,
        p_status: "recibido",
        p_discount_ves: 0,
        p_tax_ves: sum("tax_ves"),
        p_subtotal_ves: sum("subtotal_ves"),
        p_subtotal_ref: sum("subtotal_ref"),
      });
      if (error) throw new Error(`create_purchase(${purchase.number}): ${error.message}`);
      const id = data && typeof data === "object" ? (data as { id?: unknown }).id : undefined;
      if (typeof id !== "string") throw new Error(`create_purchase(${purchase.number}) no devolvió id`);
      await db.query("update public.purchases set created_at = $1 where id = $2 and store_id = $3", [
        caracasNoon(purchase.date),
        id,
        storeId,
      ]);
    }
  } finally {
    await client.auth.signOut();
  }
  return purchases.length;
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

export type ScenarioSummary = Record<
  | "productos"
  | "categorias"
  | "proveedores"
  | "vinculos"
  | "vinculosConSku"
  | "habituales"
  | "empaquesProveedor"
  | "recetas"
  | "conBarcode"
  | "compras"
  | "lineasCompra"
  | "tasas"
  | "aliases"
  | "movimientos",
  number
>;

const SUMMARY_SQL: Record<keyof ScenarioSummary, string> = {
  productos: "select count(*) from public.products where store_id = $1",
  categorias: "select count(*) from public.categories where store_id = $1",
  proveedores: "select count(*) from public.contacts where store_id = $1 and type in ('proveedor','ambos')",
  vinculos: "select count(*) from public.supplier_products where store_id = $1",
  vinculosConSku: "select count(*) from public.supplier_products where store_id = $1 and supplier_sku is not null",
  habituales: "select count(*) from public.supplier_products where store_id = $1 and is_preferred",
  empaquesProveedor:
    "select count(*) from public.supplier_product_pack_units u join public.supplier_products s on s.id = u.supplier_product_id where s.store_id = $1",
  recetas: "select count(*) from public.product_pack_conversions where store_id = $1 and is_active",
  conBarcode: "select count(*) from public.products where store_id = $1 and barcode is not null",
  compras: "select count(*) from public.purchases where store_id = $1",
  lineasCompra:
    "select count(*) from public.purchase_items i join public.purchases p on p.id = i.purchase_id where p.store_id = $1",
  tasas: "select count(*) from public.exchange_rates where store_id = $1",
  aliases: "select count(*) from public.supplier_product_aliases where store_id = $1",
  movimientos: "select count(*) from public.stock_movements where store_id = $1",
};

export async function summarizeScenario(db: Client, storeId: string): Promise<ScenarioSummary> {
  const summary = {} as ScenarioSummary;
  for (const [key, sql] of Object.entries(SUMMARY_SQL) as Array<[keyof ScenarioSummary, string]>) {
    const result = await db.query<{ count: string }>(sql, [storeId]);
    summary[key] = Number(result.rows[0].count);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Ids para el runner
// ---------------------------------------------------------------------------

export type ScenarioIds = {
  storeId: string;
  userId?: string;
  products: Record<string, string>;
  suppliers: Record<string, string>;
};

/**
 * Ids del escenario ya sembrado. `client`: service-role del lab (o la sesión
 * del admin del escenario). productKey -> products.id solo de las en catálogo;
 * supplierKey -> contacts.id.
 */
export async function loadScenarioIds(client: SupabaseClient): Promise<ScenarioIds> {
  const store = await client.from("stores").select("id").eq("slug", SCENARIO_STORE_SLUG).maybeSingle();
  if (store.error) throw new Error(`stores: ${store.error.message}`);
  const storeId = (store.data as { id: string } | null)?.id;
  if (!storeId) throw new Error(`No existe la tienda ${SCENARIO_STORE_SLUG}: corre npx tsx scripts/invoice-eval/seed-lab.ts`);

  const skuToKey = new Map<string, string>();
  SCENARIO_PRODUCTS.forEach((product, index) => {
    if (product.inCatalog) skuToKey.set(scenarioSku(index), product.key);
  });
  const [products, contacts, profiles] = await Promise.all([
    client.from("products").select("id, sku").eq("store_id", storeId).in("sku", [...skuToKey.keys()]),
    client.from("contacts").select("id, name").eq("store_id", storeId).in("type", ["proveedor", "ambos"]),
    client.from("profiles").select("id, role").eq("store_id", storeId).eq("role", "admin").limit(1),
  ]);
  for (const result of [products, contacts, profiles]) {
    if (result.error) throw new Error(`loadScenarioIds: ${result.error.message}`);
  }

  const productIds: Record<string, string> = {};
  for (const row of (products.data ?? []) as Array<{ id: string; sku: string }>) {
    const key = skuToKey.get(row.sku);
    if (key) productIds[key] = row.id;
  }
  const byName = new Map(((contacts.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.name, row.id]));
  const supplierIds: Record<string, string> = {};
  for (const supplier of SCENARIO_SUPPLIERS) {
    const id = byName.get(supplier.name);
    if (id) supplierIds[supplier.key] = id;
  }
  const missingProducts = [...skuToKey.values()].filter((key) => !productIds[key]);
  const missingSuppliers = SCENARIO_SUPPLIERS.filter((supplier) => !supplierIds[supplier.key]).map((s) => s.key);
  if (missingProducts.length > 0 || missingSuppliers.length > 0) {
    throw new Error(
      `Escenario incompleto (re-sembrar): productos ${missingProducts.join(", ") || "-"}; proveedores ${missingSuppliers.join(", ") || "-"}`,
    );
  }
  const userId = ((profiles.data ?? []) as Array<{ id: string }>)[0]?.id;
  return { storeId, ...(userId ? { userId } : {}), products: productIds, suppliers: supplierIds };
}

// ---------------------------------------------------------------------------
// Cerrojo del lab (.notes/factura-escaneo/lab.lock, el mismo que run.ts)
// ---------------------------------------------------------------------------

export type SeedLockDeps = {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
};

const LOCK_STALE_MS = 30 * 60_000;
const LOCK_RETRY_MS = 30_000;
const LOCK_MAX_WAIT_MS = 15 * 60_000;

const realLockDeps: SeedLockDeps = {
  now: () => new Date(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  log: (message) => console.warn(message),
};

/**
 * Toma el cerrojo con `evaluacion-seed <ISO>`. Dueño ajeno con < 30 min: espera
 * reintentando cada 30 s hasta 15 min y aborta. Más viejo: avisa y lo toma.
 */
async function acquireSeedLabLock(path: string, deps: SeedLockDeps): Promise<string> {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const start = deps.now().getTime();
  for (;;) {
    const stamp = `evaluacion-seed ${deps.now().toISOString()}`;
    try {
      writeFileSync(path, `${stamp}\n`, { encoding: "utf8", flag: "wx" });
      return stamp;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let holder: string;
    let ageMs: number;
    try {
      holder = readFileSync(path, "utf8").trim();
      ageMs = deps.now().getTime() - statSync(path).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; // se liberó entre medias
      throw error;
    }
    if (ageMs >= LOCK_STALE_MS) {
      deps.log(`lab.lock "${holder}" tiene ${Math.round(ageMs / 60_000)} min (> 30): lo considero abandonado y lo tomo.`);
      unlinkSync(path);
      continue;
    }
    if (deps.now().getTime() - start >= LOCK_MAX_WAIT_MS) {
      throw new Error(`El lab sigue ocupado tras 15 min (lab.lock: "${holder}"). Seed abortado sin escribir nada.`);
    }
    deps.log(`lab ocupado (lab.lock: "${holder}"): reintento en 30 s.`);
    await deps.sleep(LOCK_RETRY_MS);
  }
}

/** Corre `fn` con el cerrojo tomado y lo libera (si sigue siendo nuestro) al terminar. */
export async function withSeedLabLock<T>(
  path: string,
  fn: () => Promise<T>,
  deps: SeedLockDeps = realLockDeps,
): Promise<T> {
  const stamp = await acquireSeedLabLock(path, deps);
  try {
    return await fn();
  } finally {
    releaseLabLock(path, stamp);
  }
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

export async function runScenarioSeed(rawEnv: Record<string, string | undefined>): Promise<ScenarioSummary> {
  const env = assertScenarioEnv(rawEnv);
  return withSeedLabLock(LAB_LOCK_PATH, () => seedScenario(env));
}

async function seedScenario(env: SeedEnv): Promise<ScenarioSummary> {
  const truths = loadTruth(TRUTH_DIR);
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new Client({ connectionString: env.dbUrl, connectionTimeoutMillis: 10000 });
  await db.connect();
  try {
    const existing = await db.query<{ id: string }>("select id from public.stores where slug = $1", [SCENARIO_STORE_SLUG]);
    if (existing.rows[0]) {
      console.log(`tienda ${SCENARIO_STORE_SLUG} existente (${existing.rows[0].id}): limpiando`);
      await wipeScenarioStore(db, admin, existing.rows[0].id);
    }
    const storeId = await createStore(db);
    console.log(`tienda ${SCENARIO_STORE_SLUG} creada (${storeId})`);
    const userId = await createUser(db, admin, storeId);
    const ids = await createCatalog(db, storeId, truths);
    await createExchangeRates(db, storeId, userId, truths);
    const purchases = await createPurchases(env, db, storeId, ids, truths);
    console.log(`create_purchase recibido: ${purchases} compras ok`);
    const summary = await summarizeScenario(db, storeId);
    for (const [key, value] of Object.entries(summary)) console.log(`${key}=${value}`);
    if (summary.aliases !== 0) throw new Error(`Verificación fallida: ${summary.aliases} alias sembrados (deben ser 0)`);
    return summary;
  } finally {
    await db.end();
  }
}

async function main(): Promise<void> {
  await runScenarioSeed(loadStockLabEnv(ROOT));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
