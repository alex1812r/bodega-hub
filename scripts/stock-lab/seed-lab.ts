/**
 * Seed de la tienda "lab" para el laboratorio de stock (STK-301, fase 3).
 *
 *   npx tsx scripts/stock-lab/seed-lab.ts
 *
 * Crea (idempotente: borra y recrea todo lo de `stores.slug = 'lab'`):
 * tienda, app_settings, 5 usuarios (clave `Lab2026!`), 6 categorías (3 con IVA
 * y 3 sin), 40 productos (5 HOT, 5 pares empaque/unidad, 3 inactivos, 2 en cero,
 * 2 con mínimo alto, 18 genéricos), 3 proveedores con catálogo, 5 clientes +
 * "Consumidor final", 2 cajas y 1 tasa de cambio vigente.
 *
 * El stock inicial se carga SOLO por el camino real: login del lab-admin con la
 * anon key y RPC `adjust_stock(... p_type = 'inventario_inicial')` por producto.
 * Nunca `update products set current_stock`.
 *
 * Solo lee `.env.stock-lab` (loadStockLabEnv) y aborta si el host de la API o
 * de la base no coincide con STOCK_TEST_ALLOW_WRITES_HOST (regla 1.4 del plan).
 */
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertAllowedWriteHost, loadStockLabEnv } from "./env";

// ---------------------------------------------------------------------------
// Constantes del contrato (phase3-contracts.md → "Tienda y usuarios lab")
// ---------------------------------------------------------------------------

export const LAB_STORE_SLUG = "lab";
export const LAB_STORE_NAME = "Laboratorio Stock";
export const LAB_PASSWORD = "Lab2026!";
export const LAB_INITIAL_STOCK_REASON = "Inventario inicial lab";
export const LAB_EXCHANGE_RATE_VES = 52;
export const LAB_PACK_UNITS_PER_PACK = [6, 12, 24, 6, 12] as const;

export type LabRole = "admin" | "vendedor" | "almacen" | "contador";

export type LabUserPlan = {
  key: "admin" | "vendedor1" | "vendedor2" | "almacen" | "contador";
  email: string;
  fullName: string;
  role: LabRole;
};

export const LAB_USERS: readonly LabUserPlan[] = [
  { key: "admin", email: "lab-admin@lab.local", fullName: "Lab Admin", role: "admin" },
  { key: "vendedor1", email: "lab-vendedor-1@lab.local", fullName: "Lab Vendedor 1", role: "vendedor" },
  { key: "vendedor2", email: "lab-vendedor-2@lab.local", fullName: "Lab Vendedor 2", role: "vendedor" },
  { key: "almacen", email: "lab-almacen@lab.local", fullName: "Lab Almacén", role: "almacen" },
  { key: "contador", email: "lab-contador@lab.local", fullName: "Lab Contador", role: "contador" },
];

export const LAB_CASH_REGISTERS: ReadonlyArray<{ name: string; userKey: LabUserPlan["key"] }> = [
  { name: "Caja Lab 1", userKey: "vendedor1" },
  { name: "Caja Lab 2", userKey: "vendedor2" },
];

// ---------------------------------------------------------------------------
// Plan puro del catálogo (testeable sin base)
// ---------------------------------------------------------------------------

export type LabCategoryPlan = { key: string; name: string; taxRate: number };

export type LabProductKind = "hot" | "pack" | "unit" | "inactive" | "zero" | "min" | "generic";

export type LabProductPlan = {
  sku: string;
  name: string;
  kind: LabProductKind;
  categoryKey: string;
  barcode: string | null;
  salePriceRef: number;
  currentCostRef: number;
  minStock: number;
  isActive: boolean;
  /** Stock que se cargará vía adjust_stock (0 = no se llama al RPC). */
  initialStock: number;
};

export type LabPackPairPlan = { packSku: string; unitSku: string; unitsPerPack: number };

export type LabSupplierPlan = {
  name: string;
  taxId: string;
  /** SKUs de productos que suministra. */
  productSkus: string[];
  /** SKUs (subconjunto de productSkus) con empaque de proveedor. */
  packUnits: Array<{ sku: string; label: string; unitsPerPack: number }>;
};

export type LabCustomerPlan = { name: string; taxId: string | null; isPosDefault: boolean };

export type LabCatalogPlan = {
  categories: LabCategoryPlan[];
  products: LabProductPlan[];
  packPairs: LabPackPairPlan[];
  suppliers: LabSupplierPlan[];
  customers: LabCustomerPlan[];
};

const CATEGORY_PLANS: readonly LabCategoryPlan[] = [
  { key: "bebidas", name: "Bebidas Lab", taxRate: 16 },
  { key: "snacks", name: "Snacks Lab", taxRate: 16 },
  { key: "limpieza", name: "Limpieza Lab", taxRate: 16 },
  { key: "basicos", name: "Alimentos básicos Lab", taxRate: 0 },
  { key: "frutas", name: "Frutas y verduras Lab", taxRate: 0 },
  { key: "panaderia", name: "Panadería Lab", taxRate: 0 },
];

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** EAN-13 determinista con prefijo 759 (Venezuela) y dígito de control válido. */
export function labEan13(index: number): string {
  const body = `759${pad(index, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(body[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${body}${check}`;
}

function product(
  index: number,
  sku: string,
  name: string,
  kind: LabProductKind,
  overrides: Partial<LabProductPlan> = {},
): LabProductPlan {
  const salePriceRef = roundMoney(1 + index * 0.35);
  return {
    sku,
    name,
    kind,
    categoryKey: CATEGORY_PLANS[index % CATEGORY_PLANS.length].key,
    // ~la mitad con barcode: índices pares (los HOT siempre, se fuerzan abajo).
    barcode: index % 2 === 0 ? labEan13(index + 1) : null,
    salePriceRef,
    currentCostRef: roundMoney(salePriceRef * 0.6),
    minStock: 5,
    isActive: true,
    initialStock: 50 + index * 10,
    ...overrides,
  };
}

/** Construye el plan determinista del catálogo lab (sin tocar la base). */
export function buildLabCatalog(): LabCatalogPlan {
  const products: LabProductPlan[] = [];
  let index = 0;
  const next = () => {
    const current = index;
    index += 1;
    return current;
  };

  for (let n = 1; n <= 5; n += 1) {
    const i = next();
    products.push(
      product(i, `LAB-HOT-${pad(n, 2)}`, `Producto caliente ${n}`, "hot", {
        barcode: labEan13(i + 1),
        initialStock: 500 + (n - 1) * 125,
      }),
    );
  }

  const packPairs: LabPackPairPlan[] = [];
  LAB_PACK_UNITS_PER_PACK.forEach((unitsPerPack, idx) => {
    const n = idx + 1;
    const packIndex = next();
    const unitIndex = next();
    const packSku = `LAB-PACK-${pad(n, 2)}`;
    const unitSku = `LAB-UNIT-${pad(n, 2)}`;
    products.push(
      product(packIndex, packSku, `Empaque ${n} (x${unitsPerPack})`, "pack", {
        initialStock: 40 + n * 5,
      }),
    );
    products.push(
      product(unitIndex, unitSku, `Unidad ${n}`, "unit", {
        categoryKey: products[products.length - 1].categoryKey,
        initialStock: 100 + n * 10,
      }),
    );
    packPairs.push({ packSku, unitSku, unitsPerPack });
  });

  for (let n = 1; n <= 3; n += 1) {
    products.push(
      product(next(), `LAB-INACT-${pad(n, 2)}`, `Producto inactivo ${n}`, "inactive", {
        isActive: false,
        initialStock: 10 * n,
      }),
    );
  }

  for (let n = 1; n <= 2; n += 1) {
    products.push(
      product(next(), `LAB-ZERO-${pad(n, 2)}`, `Producto sin stock ${n}`, "zero", {
        initialStock: 0,
      }),
    );
  }

  for (let n = 1; n <= 2; n += 1) {
    products.push(
      product(next(), `LAB-MIN-${pad(n, 2)}`, `Producto bajo mínimo ${n}`, "min", {
        minStock: 500,
        initialStock: 20,
      }),
    );
  }

  let generic = 1;
  while (products.length < 40) {
    products.push(product(next(), `LAB-${pad(generic, 3)}`, `Producto genérico ${generic}`, "generic"));
    generic += 1;
  }

  // Proveedores: ~8 productos activos cada uno, sin solapar.
  const supplyable = products.filter((p) => p.isActive && p.kind !== "unit").map((p) => p.sku);
  const supplierNames: Array<[string, string]> = [
    ["Distribuidora Lab Norte", "J-LAB-00001"],
    ["Mayorista Lab Centro", "J-LAB-00002"],
    ["Importadora Lab Sur", "J-LAB-00003"],
  ];
  const suppliers: LabSupplierPlan[] = supplierNames.map(([name, taxId], s) => {
    const productSkus = supplyable.slice(s * 8, s * 8 + 8);
    const packUnits = productSkus
      .filter((_, i) => i % 3 === 0)
      .map((sku, i) => ({ sku, label: i % 2 === 0 ? "Bulto x12" : "Caja x24", unitsPerPack: i % 2 === 0 ? 12 : 24 }));
    return { name, taxId, productSkus, packUnits };
  });

  const customers: LabCustomerPlan[] = [
    { name: "Consumidor final", taxId: null, isPosDefault: true },
    ...[1, 2, 3, 4, 5].map((n) => ({ name: `Cliente Lab ${n}`, taxId: `V-LAB-${pad(n, 5)}`, isPosDefault: false })),
  ];

  return { categories: [...CATEGORY_PLANS], products, packPairs, suppliers, customers };
}

// ---------------------------------------------------------------------------
// Entorno (puro, testeable sin conectar)
// ---------------------------------------------------------------------------

export type SeedEnv = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
  allowedHost: string;
};

/** Valida variables y hosts permitidos. Lanza Error (sin conectar) si algo falla. */
export function assertSeedEnv(env: Record<string, string | undefined>): SeedEnv {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STOCK_LAB_DB_URL",
  ] as const;
  for (const key of required) {
    if (!env[key]?.trim()) throw new Error(`${key} no está definida en .env.stock-lab`);
  }
  const allowedHost = env.STOCK_TEST_ALLOW_WRITES_HOST;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL as string;
  const dbUrl = env.STOCK_LAB_DB_URL as string;
  assertAllowedWriteHost(supabaseUrl, allowedHost);
  assertAllowedWriteHost(dbUrl, allowedHost);
  return {
    supabaseUrl,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY as string,
    dbUrl,
    allowedHost: allowedHost as string,
  };
}

// ---------------------------------------------------------------------------
// Limpieza idempotente
// ---------------------------------------------------------------------------

/** Orden de borrado por store_id respetando FKs RESTRICT (hijos antes que padres). */
export const STORE_SCOPED_DELETE_ORDER: readonly string[] = [
  "payroll_commission_sales",
  "payroll_items",
  "payroll_periods",
  "payroll_employees",
  "payroll_settings",
  "vault_movements",
  "cash_movements",
  "store_vaults",
  "stock_movements",
  "payments",
  "sales", // sale_items en cascada
  "purchases", // purchase_items en cascada
  "cash_sessions",
  "cash_registers",
  "supplier_products", // supplier_product_pack_units / price history en cascada
  "product_pack_conversions",
  "products", // product_price_history en cascada
  "categories",
  "contacts",
  "exchange_rates",
  "assistant_queries",
  "app_settings",
  "profiles",
];

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
  return result.rows.map((r) => r.table_name);
}

async function wipeLabStore(db: Client, admin: SupabaseClient, storeId: string): Promise<void> {
  const tables = await storeScopedTables(db);
  const unknown = tables.filter((t) => !STORE_SCOPED_DELETE_ORDER.includes(t));
  const order = [...unknown, ...STORE_SCOPED_DELETE_ORDER.filter((t) => tables.includes(t))];

  const users = await db.query<{ id: string }>(
    `select u.id from auth.users u
      where u.id in (select id from public.profiles where store_id = $1)
         or u.email = any($2::text[])`,
    [storeId, LAB_USERS.map((u) => u.email)],
  );

  await db.query("begin");
  try {
    for (const table of order) {
      try {
        await db.query(`delete from public.${table} where store_id = $1`, [storeId]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`No se pudo limpiar public.${table} de la tienda lab: ${message}`);
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

type Created = {
  storeId: string;
  userIds: Record<LabUserPlan["key"], string>;
  productIds: Record<string, string>;
};

async function createStoreAndSettings(db: Client): Promise<string> {
  const store = await db.query<{ id: string }>(
    `insert into public.stores (name, slug, status, notes)
     values ($1, $2, 'active', 'Tienda del laboratorio de stock (seed-lab.ts). Solo local.')
     returning id`,
    [LAB_STORE_NAME, LAB_STORE_SLUG],
  );
  const storeId = store.rows[0].id;
  // Mismos valores que createStore (src/modules/platform/services/stores.server.ts).
  await db.query(
    `insert into public.app_settings (id, business_name, default_tax_rate, invoice_prefix, low_stock_threshold, store_id)
     values (1, $1, 0, 'FAC', 5, $2)`,
    [LAB_STORE_NAME, storeId],
  );
  return storeId;
}

async function createUsers(db: Client, admin: SupabaseClient, storeId: string): Promise<Created["userIds"]> {
  const ids: Partial<Created["userIds"]> = {};
  for (const user of LAB_USERS) {
    const { data, error } = await admin.auth.admin.createUser({
      email: user.email,
      password: LAB_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: user.fullName, role: user.role, store_id: storeId },
    });
    if (error || !data.user) {
      throw new Error(`auth.admin.createUser(${user.email}): ${error?.message ?? "sin usuario"}`);
    }
    // El trigger handle_new_user crea el profile; se fuerza store_id/role por si acaso.
    await db.query(
      `insert into public.profiles (id, full_name, role, store_id, is_active)
       values ($1, $2, $3::public.user_role, $4, true)
       on conflict (id) do update
         set full_name = excluded.full_name, role = excluded.role, store_id = excluded.store_id, is_active = true`,
      [data.user.id, user.fullName, user.role, storeId],
    );
    const check = await db.query<{ store_id: string; role: string }>(
      "select store_id, role from public.profiles where id = $1",
      [data.user.id],
    );
    const row = check.rows[0];
    if (!row || row.store_id !== storeId || row.role !== user.role) {
      throw new Error(`profiles de ${user.email} no quedó en la tienda lab con rol ${user.role}`);
    }
    ids[user.key] = data.user.id;
  }
  return ids as Created["userIds"];
}

async function createCatalog(db: Client, storeId: string, plan: LabCatalogPlan): Promise<Record<string, string>> {
  const categoryIds: Record<string, string> = {};
  for (const category of plan.categories) {
    const result = await db.query<{ id: string }>(
      `insert into public.categories (store_id, name, tax_rate, is_active) values ($1, $2, $3, true) returning id`,
      [storeId, category.name, category.taxRate],
    );
    categoryIds[category.key] = result.rows[0].id;
  }

  const productIds: Record<string, string> = {};
  for (const p of plan.products) {
    const result = await db.query<{ id: string }>(
      `insert into public.products
         (store_id, category_id, sku, barcode, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)
       returning id`,
      [storeId, categoryIds[p.categoryKey], p.sku, p.barcode, p.name, p.salePriceRef, p.currentCostRef, p.minStock, p.isActive],
    );
    productIds[p.sku] = result.rows[0].id;
  }

  for (const pair of plan.packPairs) {
    await db.query(
      `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, is_active)
       values ($1, $2, $3, $4, true)`,
      [storeId, productIds[pair.packSku], productIds[pair.unitSku], pair.unitsPerPack],
    );
  }

  for (const supplier of plan.suppliers) {
    const contact = await db.query<{ id: string }>(
      `insert into public.contacts (store_id, type, name, tax_id, is_active)
       values ($1, 'proveedor', $2, $3, true) returning id`,
      [storeId, supplier.name, supplier.taxId],
    );
    const supplierId = contact.rows[0].id;
    for (const sku of supplier.productSkus) {
      const cost = plan.products.find((p) => p.sku === sku)?.currentCostRef ?? 0;
      const sp = await db.query<{ id: string }>(
        `insert into public.supplier_products (store_id, supplier_id, product_id, supplier_sku, last_cost_ref, last_cost_ves, is_active)
         values ($1, $2, $3, $4, $5, $6, true) returning id`,
        [storeId, supplierId, productIds[sku], `${supplier.taxId.slice(-2)}-${sku}`, cost, roundMoney(cost * LAB_EXCHANGE_RATE_VES)],
      );
      const packUnit = supplier.packUnits.find((u) => u.sku === sku);
      if (packUnit) {
        await db.query(
          `insert into public.supplier_product_pack_units (supplier_product_id, label, units_per_pack, is_default, is_active)
           values ($1, $2, $3, true, true)`,
          [sp.rows[0].id, packUnit.label, packUnit.unitsPerPack],
        );
      }
    }
  }

  for (const customer of plan.customers) {
    await db.query(
      `insert into public.contacts (store_id, type, name, tax_id, notes, is_active, is_pos_default)
       values ($1, 'cliente', $2, $3, $4, true, $5)`,
      [
        storeId,
        customer.name,
        customer.taxId,
        customer.isPosDefault ? "Cliente sistema para ventas rapidas en POS. No desactivar." : null,
        customer.isPosDefault,
      ],
    );
  }

  return productIds;
}

async function createRegistersAndRate(db: Client, storeId: string, userIds: Created["userIds"]): Promise<void> {
  for (const register of LAB_CASH_REGISTERS) {
    await db.query(
      `insert into public.cash_registers (store_id, name, assigned_user_id, is_active) values ($1, $2, $3, true)`,
      [storeId, register.name, userIds[register.userKey]],
    );
  }
  await db.query(
    `insert into public.exchange_rates (store_id, rate_ves, source, notes, created_by) values ($1, $2, 'Manual', 'seed-lab', $3)`,
    [storeId, LAB_EXCHANGE_RATE_VES, userIds.admin],
  );
}

/** Stock inicial por el camino real: login lab-admin (anon key) + RPC adjust_stock. */
async function loadInitialStock(env: SeedEnv, plan: LabCatalogPlan, productIds: Record<string, string>): Promise<number> {
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = LAB_USERS.find((u) => u.key === "admin");
  if (!admin) throw new Error("No hay usuario admin en LAB_USERS");
  const { error: loginError } = await client.auth.signInWithPassword({ email: admin.email, password: LAB_PASSWORD });
  if (loginError) throw new Error(`signInWithPassword(${admin.email}): ${loginError.message}`);

  let movements = 0;
  try {
    for (const p of plan.products) {
      if (p.initialStock <= 0) continue;
      const { error } = await client.rpc("adjust_stock", {
        p_product_id: productIds[p.sku],
        p_quantity_delta: p.initialStock,
        p_reason: LAB_INITIAL_STOCK_REASON,
        p_type: "inventario_inicial",
      });
      if (error) throw new Error(`adjust_stock(${p.sku}, ${p.initialStock}): ${error.message}`);
      movements += 1;
    }
  } finally {
    await client.auth.signOut();
  }
  return movements;
}

// ---------------------------------------------------------------------------
// Resumen y verificación
// ---------------------------------------------------------------------------

export type SeedSummary = {
  productos: number;
  inactivos: number;
  stockCero: number;
  pares: number;
  usuarios: number;
  cajas: number;
  proveedores: number;
  clientes: number;
  categorias: number;
  movimientosInventarioInicial: number;
  productosConStock: number;
};

async function count(db: Client, sql: string, storeId: string): Promise<number> {
  const result = await db.query<{ n: string }>(sql, [storeId]);
  return Number(result.rows[0].n);
}

async function summarize(db: Client, storeId: string): Promise<SeedSummary> {
  return {
    productos: await count(db, "select count(*)::text as n from public.products where store_id = $1", storeId),
    inactivos: await count(db, "select count(*)::text as n from public.products where store_id = $1 and is_active = false", storeId),
    stockCero: await count(db, "select count(*)::text as n from public.products where store_id = $1 and current_stock = 0", storeId),
    pares: await count(db, "select count(*)::text as n from public.product_pack_conversions where store_id = $1 and is_active", storeId),
    usuarios: await count(db, "select count(*)::text as n from public.profiles where store_id = $1", storeId),
    cajas: await count(db, "select count(*)::text as n from public.cash_registers where store_id = $1", storeId),
    proveedores: await count(db, "select count(*)::text as n from public.contacts where store_id = $1 and type in ('proveedor','ambos')", storeId),
    clientes: await count(db, "select count(*)::text as n from public.contacts where store_id = $1 and type in ('cliente','ambos')", storeId),
    categorias: await count(db, "select count(*)::text as n from public.categories where store_id = $1", storeId),
    movimientosInventarioInicial: await count(
      db,
      "select count(*)::text as n from public.stock_movements where store_id = $1 and type = 'inventario_inicial'",
      storeId,
    ),
    productosConStock: await count(db, "select count(*)::text as n from public.products where store_id = $1 and current_stock > 0", storeId),
  };
}

export function formatSummary(summary: SeedSummary): string[] {
  return [
    `productos=${summary.productos}`,
    `inactivos=${summary.inactivos}`,
    `stock_cero=${summary.stockCero}`,
    `pares_empaque=${summary.pares}`,
    `usuarios=${summary.usuarios}`,
    `cajas=${summary.cajas}`,
    `proveedores=${summary.proveedores}`,
    `clientes=${summary.clientes}`,
    `categorias=${summary.categorias}`,
    `movimientos_inventario_inicial=${summary.movimientosInventarioInicial} (productos con stock>0: ${summary.productosConStock})`,
  ];
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

/** Ejecuta el seed completo. Valida el entorno ANTES de abrir cualquier conexión. */
export async function runSeed(rawEnv: Record<string, string | undefined>): Promise<SeedSummary> {
  const env = assertSeedEnv(rawEnv);
  const plan = buildLabCatalog();

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = new Client({ connectionString: env.dbUrl, connectionTimeoutMillis: 10000 });
  await db.connect();
  try {
    const existing = await db.query<{ id: string }>("select id from public.stores where slug = $1", [LAB_STORE_SLUG]);
    if (existing.rows[0]) {
      console.log(`tienda ${LAB_STORE_SLUG} existente (${existing.rows[0].id}): limpiando`);
      await wipeLabStore(db, admin, existing.rows[0].id);
    }

    const storeId = await createStoreAndSettings(db);
    console.log(`tienda ${LAB_STORE_SLUG} creada (${storeId})`);
    const userIds = await createUsers(db, admin, storeId);
    const productIds = await createCatalog(db, storeId, plan);
    await createRegistersAndRate(db, storeId, userIds);
    const rpcCalls = await loadInitialStock(env, plan, productIds);
    console.log(`adjust_stock inventario_inicial: ${rpcCalls} llamadas ok`);

    const summary = await summarize(db, storeId);
    for (const line of formatSummary(summary)) console.log(line);
    if (summary.movimientosInventarioInicial !== summary.productosConStock) {
      throw new Error(
        `Verificación fallida: ${summary.movimientosInventarioInicial} movimientos inventario_inicial ` +
          `vs ${summary.productosConStock} productos con stock > 0`,
      );
    }
    return summary;
  } finally {
    await db.end();
  }
}

async function main(): Promise<void> {
  const root = resolve(__dirname, "../..");
  const file = loadStockLabEnv(root);
  await runSeed(file);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
