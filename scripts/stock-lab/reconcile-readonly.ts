/**
 * Informe de inventario en modo SOLO LECTURA (STK-604, plan stock-integrity
 * seccion 8.4). Es el camino de `reconcile.ts --target production --read-only`.
 *
 * Garantias:
 *   - No crea ningun objeto: las 9 comprobaciones de las vistas de integridad
 *     (parches 20261005 + 20261006d) van como SELECT inline.
 *   - Toda sentencia pasa por `createReadOnlyQuery`, que solo deja salir
 *     `SELECT` / `WITH ... SELECT`, `BEGIN ... READ ONLY` y `ROLLBACK`.
 *   - La sesion completa va dentro de una transaccion READ ONLY que termina
 *     siempre en ROLLBACK: Postgres mismo rechaza cualquier escritura.
 *   - Detecta por `information_schema` que columnas existen: sin
 *     `stock_movements.seq` la cadena se ordena por created_at,id; si falta otra
 *     columna la comprobacion se degrada o queda como "no evaluable".
 *
 * Sin I/O propio: recibe el cliente (inyectable en tests) y devuelve el informe.
 */
import {
  INTEGRITY_VIEW_NAMES,
  type IntegrityReport,
  type IntegrityViewName,
  type ReconcileArgs,
  assertProductionReadOnly,
  buildReportFromCounts,
} from "./integrity-views";

export type Row = Record<string, unknown>;

/** Lo minimo que se usa de `pg.Client`: permite inyectar un cliente falso o uno ya en transaccion. */
export interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export type ReadOnlyQuery = (sql: string, params?: readonly unknown[]) => Promise<Row[]>;

// ------------------------------------------------------------------ guarda

export const BEGIN_READ_ONLY = "begin transaction isolation level repeatable read, read only";
export const ROLLBACK = "rollback";

const BEGIN_FORMS: ReadonlySet<string> = new Set([
  "begin read only",
  "begin transaction read only",
  BEGIN_READ_ONLY,
]);

/** Palabras que no pueden aparecer (como token completo) en un SELECT de este modo. */
const FORBIDDEN_WORDS: ReadonlySet<string> = new Set([
  "alter",
  "analyze",
  "begin",
  "call",
  "checkpoint",
  "cluster",
  "comment",
  "commit",
  "copy",
  "create",
  "deallocate",
  "declare",
  "delete",
  "discard",
  "do",
  "drop",
  "execute",
  "explain",
  "fetch",
  "for",
  "grant",
  "import",
  "insert",
  "into",
  "listen",
  "load",
  "lock",
  "merge",
  "move",
  "notify",
  "prepare",
  "reassign",
  "refresh",
  "reindex",
  "release",
  "reset",
  "revoke",
  "rollback",
  "savepoint",
  "set",
  "start",
  "truncate",
  "unlisten",
  "update",
  "vacuum",
]);

/**
 * Unicos identificadores que pueden ir seguidos de "(": palabras clave de un
 * SELECT y funciones sin efectos. Cualquier otra llamada (nextval, set_config,
 * pg_notify, dblink, funciones del esquema public...) se rechaza.
 */
const ALLOWED_BEFORE_PAREN: ReadonlySet<string> = new Set([
  "all",
  "and",
  "as",
  "by",
  "else",
  "exists",
  "from",
  "in",
  "join",
  "not",
  "on",
  "or",
  "over",
  "select",
  "then",
  "union",
  "when",
  "where",
  "abs",
  "coalesce",
  "count",
  "current_setting",
  "lag",
  "max",
  "min",
  "row_number",
  "sign",
  "sum",
]);

export type ReadOnlyStatementKind = "begin" | "rollback" | "select";

function reject(reason: string, sql: string): never {
  throw new Error(`Modo solo lectura: sentencia rechazada (${reason}): ${sql.trim().slice(0, 160)}`);
}

/**
 * Lanza si `sql` no es `SELECT` / `WITH ... SELECT`, `BEGIN ... READ ONLY` o
 * `ROLLBACK`. Es deliberadamente mas estricta que SQL: rechaza comentarios,
 * identificadores entre comillas, dollar-quoting, `;`, `SELECT ... INTO`,
 * `FOR UPDATE/SHARE`, CTE con escritura y cualquier funcion fuera de la lista.
 */
export function assertReadOnlyStatement(sql: string): ReadOnlyStatementKind {
  if (!/^[\t\n\r\x20-\x7e]*$/.test(sql)) reject("caracteres fuera de ASCII imprimible", sql);
  if (sql.includes("\\")) reject("barra invertida", sql);
  const bare = sql.replace(/'(?:[^']|'')*'/g, " ? ").toLowerCase();
  if (bare.includes("'")) reject("literal sin cerrar", sql);
  if (bare.includes('"')) reject("identificador entre comillas", sql);
  if (bare.includes("--") || bare.includes("/*")) reject("comentario", sql);
  if (bare.includes(";")) reject("mas de una sentencia", sql);
  if (/\$(?!\d)/.test(bare)) reject("dollar-quoting", sql);

  const normalized = bare.replace(/\s+/g, " ").trim();
  if (BEGIN_FORMS.has(normalized)) return "begin";
  if (normalized === ROLLBACK) return "rollback";
  if (!/^(select|with)\b/.test(normalized)) reject("no es SELECT ni WITH ... SELECT", sql);

  const tokens = /[a-z_][a-z0-9_]*/g;
  for (let match = tokens.exec(bare); match; match = tokens.exec(bare)) {
    const word = match[0];
    if (FORBIDDEN_WORDS.has(word)) reject(`palabra prohibida "${word}"`, sql);
    const followedByParen = /^\s*\(/.test(bare.slice(match.index + word.length));
    if (followedByParen && !ALLOWED_BEFORE_PAREN.has(word)) reject(`funcion no permitida "${word}"`, sql);
  }
  return "select";
}

/** La UNICA puerta hacia `client.query` en modo solo lectura. */
export function createReadOnlyQuery(client: QueryClient): ReadOnlyQuery {
  return async (sql, params = []) => {
    assertReadOnlyStatement(sql);
    const result = params.length > 0 ? await client.query(sql, [...params]) : await client.query(sql);
    return result.rows;
  };
}

// ------------------------------------------------------------ capacidades

export type ChainOrder = "seq" | "created_at,id";

export interface Capabilities {
  /** Columnas presentes como "tabla.columna" (esquema public). */
  columns: ReadonlySet<string>;
  /** Vistas de integridad que ya existen en la base (solo informativo: nunca se consultan). */
  integrityViews: IntegrityViewName[];
}

const SCHEMA_TABLES = [
  "products",
  "stock_movements",
  "sales",
  "sale_items",
  "purchases",
  "purchase_items",
  "product_pack_conversions",
  "stores",
] as const;

function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export const CAPABILITY_COLUMNS_SQL = `select c.table_name, c.column_name
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (${sqlList(SCHEMA_TABLES)})`;

export const CAPABILITY_VIEWS_SQL = `select v.table_name
from information_schema.views v
where v.table_schema = 'public'
  and v.table_name in (${sqlList(INTEGRITY_VIEW_NAMES)})`;

export async function detectCapabilities(query: ReadOnlyQuery): Promise<Capabilities> {
  const columns = new Set<string>();
  for (const row of await query(CAPABILITY_COLUMNS_SQL)) columns.add(`${String(row.table_name)}.${String(row.column_name)}`);
  const present = new Set((await query(CAPABILITY_VIEWS_SQL)).map((row) => String(row.table_name)));
  return { columns, integrityViews: INTEGRITY_VIEW_NAMES.filter((name) => present.has(name)) };
}

// ---------------------------------------------------------- comprobaciones

export const CHAIN_ORDER_WARNING = "cadena ordenada por created_at,id: puede haber falsos positivos bajo concurrencia";
export const NO_CHAIN_BREAK_LABEL = "diff sin rotura de cadena: stock escrito fuera del libro";

type ColumnSpec = Readonly<Partial<Record<(typeof SCHEMA_TABLES)[number], string>>>;

/** Columnas sin las que la comprobacion no se puede evaluar (las degradables van aparte). */
const REQUIRED_COLUMNS: Record<IntegrityViewName, ColumnSpec> = {
  stock_reconciliation: {
    products: "id store_id sku name current_stock",
    stock_movements: "product_id quantity_delta created_at",
  },
  stock_chain_breaks: {
    stock_movements: "id product_id store_id type created_at quantity_delta stock_after",
    products: "id store_id",
  },
  sales_without_movements: {
    sale_items: "id sale_id product_id quantity",
    sales: "id store_id status",
    stock_movements: "sale_id product_id quantity_delta type",
  },
  purchases_without_movements: {
    purchase_items: "id purchase_id product_id quantity",
    purchases: "id store_id status",
    stock_movements: "purchase_id product_id quantity_delta type",
  },
  movements_without_document: {
    stock_movements: "id product_id store_id type sale_id purchase_id quantity_delta",
    products: "id store_id",
    sales: "id status",
    purchases: "id status",
    sale_items: "sale_id product_id",
    purchase_items: "purchase_id product_id",
  },
  reversal_mismatches: {
    sales: "id store_id status",
    purchases: "id store_id status",
    stock_movements: "sale_id purchase_id product_id type quantity_delta",
  },
  conversion_mismatches: {
    stock_movements: "conversion_id store_id type product_id quantity_delta",
    products: "id store_id",
    product_pack_conversions: "pack_product_id unit_product_id units_per_pack is_active updated_at created_at",
  },
  negative_stock: {
    products: "id store_id current_stock",
    stock_movements: "id product_id store_id stock_after",
  },
  cross_store_movements: {
    stock_movements: "id store_id product_id sale_id purchase_id",
    products: "id store_id",
    sales: "id store_id",
    purchases: "id store_id",
  },
};

const PACK_COLUMNS = ["purchase_items.entry_mode", "purchase_items.pack_count", "purchase_items.units_per_pack"];

function missingColumns(caps: Capabilities, spec: ColumnSpec): string[] {
  const missing: string[] = [];
  for (const table of SCHEMA_TABLES) {
    for (const column of (spec[table] ?? "").split(" ").filter(Boolean)) {
      if (!caps.columns.has(`${table}.${column}`)) missing.push(`${table}.${column}`);
    }
  }
  return missing;
}

const STOCK_RECONCILIATION_SQL = `select
  p.id as product_id,
  p.store_id,
  p.sku,
  p.name,
  p.current_stock,
  coalesce(m.ledger_stock, 0)::integer as ledger_stock,
  (p.current_stock - coalesce(m.ledger_stock, 0))::integer as diff,
  coalesce(m.movements_count, 0)::bigint as movements_count,
  m.last_movement_at
from public.products p
left join (
  select
    sm.product_id,
    sum(sm.quantity_delta) as ledger_stock,
    count(*) as movements_count,
    max(sm.created_at) as last_movement_at
  from public.stock_movements sm
  group by sm.product_id
) m on m.product_id = p.id
where p.current_stock - coalesce(m.ledger_stock, 0) <> 0`;

/** v2 (20261006d): orden real del libro. */
const CHAIN_BREAKS_BY_SEQ_SQL = `with ordered as (
  select
    m.id,
    m.product_id,
    coalesce(p.store_id, m.store_id) as store_id,
    m.type,
    m.created_at,
    m.quantity_delta,
    m.stock_after,
    m.seq,
    lag(m.id) over w as prev_movement_id,
    lag(m.stock_after) over w as prev_stock_after
  from public.stock_movements m
  left join public.products p on p.id = m.product_id
  window w as (partition by m.product_id order by m.seq)
)
select
  o.id as movement_id,
  o.product_id,
  o.store_id,
  o.type,
  o.created_at,
  o.quantity_delta,
  (o.prev_stock_after + o.quantity_delta)::integer as expected_stock_after,
  o.stock_after,
  o.prev_movement_id,
  o.seq
from ordered o
where o.prev_movement_id is not null
  and o.stock_after <> o.prev_stock_after + o.quantity_delta`;

/** v1 (20261005): unica opcion sin `stock_movements.seq`. */
const CHAIN_BREAKS_BY_CREATED_AT_SQL = `with ordered as (
  select
    m.id,
    m.product_id,
    coalesce(p.store_id, m.store_id) as store_id,
    m.type,
    m.created_at,
    m.quantity_delta,
    m.stock_after,
    lag(m.id) over w as prev_movement_id,
    lag(m.stock_after) over w as prev_stock_after
  from public.stock_movements m
  left join public.products p on p.id = m.product_id
  window w as (partition by m.product_id order by m.created_at, m.id)
)
select
  o.id as movement_id,
  o.product_id,
  o.store_id,
  o.type,
  o.created_at,
  o.quantity_delta,
  (o.prev_stock_after + o.quantity_delta)::integer as expected_stock_after,
  o.stock_after,
  o.prev_movement_id
from ordered o
where o.prev_movement_id is not null
  and o.stock_after <> o.prev_stock_after + o.quantity_delta`;

const SALES_WITHOUT_MOVEMENTS_SQL = `with items as (
  select
    si.id as sale_item_id,
    si.sale_id,
    s.store_id,
    si.product_id,
    si.quantity,
    sum(si.quantity) over (partition by si.sale_id, si.product_id) as product_quantity
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.status not in ('cancelada', 'borrador')
),
moves as (
  select
    sm.sale_id,
    sm.product_id,
    sum(sm.quantity_delta) as movement_delta
  from public.stock_movements sm
  where sm.type = 'venta'
    and sm.sale_id is not null
  group by sm.sale_id, sm.product_id
)
select
  i.sale_id,
  i.sale_item_id,
  i.store_id,
  i.product_id,
  i.quantity,
  mv.movement_delta::integer as movement_delta,
  case when mv.movement_delta is null then 'missing' else 'delta_mismatch' end::text as issue
from items i
left join moves mv on mv.sale_id = i.sale_id and mv.product_id = i.product_id
where mv.movement_delta is null
   or mv.movement_delta <> -i.product_quantity`;

const PACK_NORMALIZED_QUANTITY = `case
      when pi.entry_mode = 'pack' then pi.pack_count * pi.units_per_pack
      else pi.quantity
    end`;

function purchasesWithoutMovementsSql(normalizedQuantity: string): string {
  return `with items as (
  select
    pi.id as purchase_item_id,
    pi.purchase_id,
    pu.store_id,
    pi.product_id,
    pi.quantity,
    ${normalizedQuantity} as normalized_quantity
  from public.purchase_items pi
  join public.purchases pu on pu.id = pi.purchase_id
  where pu.status = 'recibido'
),
items_sum as (
  select
    i.*,
    sum(i.normalized_quantity) over (partition by i.purchase_id, i.product_id) as product_quantity
  from items i
),
moves as (
  select
    sm.purchase_id,
    sm.product_id,
    sum(sm.quantity_delta) as movement_delta
  from public.stock_movements sm
  where sm.type = 'compra'
    and sm.purchase_id is not null
  group by sm.purchase_id, sm.product_id
)
select
  i.purchase_id,
  i.purchase_item_id,
  i.store_id,
  i.product_id,
  i.quantity,
  i.normalized_quantity::integer as normalized_quantity,
  mv.movement_delta::integer as movement_delta,
  case when mv.movement_delta is null then 'missing' else 'delta_mismatch' end::text as issue
from items_sum i
left join moves mv on mv.purchase_id = i.purchase_id and mv.product_id = i.product_id
where mv.movement_delta is null
   or mv.movement_delta is distinct from i.product_quantity`;
}

const MOVEMENTS_WITHOUT_DOCUMENT_SQL = `select
  m.id as movement_id,
  coalesce(p.store_id, m.store_id) as store_id,
  m.product_id,
  m.type,
  m.sale_id,
  m.purchase_id,
  case
    when (m.type = 'venta' and m.sale_id is null)
      or (m.type = 'compra' and m.purchase_id is null) then 'null_document'
    when (m.type = 'venta' and s.id is null)
      or (m.type = 'compra' and pu.id is null) then 'missing_document'
    when (m.type = 'venta' and not exists (
            select 1 from public.sale_items si
            where si.sale_id = m.sale_id and si.product_id = m.product_id))
      or (m.type = 'compra' and not exists (
            select 1 from public.purchase_items pi
            where pi.purchase_id = m.purchase_id and pi.product_id = m.product_id)) then 'missing_document_line'
    when (m.type = 'venta' and s.status = 'borrador')
      or (m.type = 'compra' and pu.status = 'pedido') then 'document_status_mismatch'
    else 'cancelled_without_reversal'
  end::text as issue
from public.stock_movements m
left join public.products p on p.id = m.product_id
left join public.sales s on s.id = m.sale_id
left join public.purchases pu on pu.id = m.purchase_id
where (
    m.type = 'venta'
    and (
      m.sale_id is null
      or s.id is null
      or not exists (
        select 1 from public.sale_items si
        where si.sale_id = m.sale_id and si.product_id = m.product_id
      )
      or s.status = 'borrador'
      or (
        s.status in ('cancelada', 'devuelta')
        and not exists (
          select 1
          from public.stock_movements r
          where r.sale_id = m.sale_id
            and r.product_id = m.product_id
            and r.id <> m.id
            and sign(r.quantity_delta) = -sign(m.quantity_delta)
        )
      )
    )
  )
  or (
    m.type = 'compra'
    and (
      m.purchase_id is null
      or pu.id is null
      or not exists (
        select 1 from public.purchase_items pi
        where pi.purchase_id = m.purchase_id and pi.product_id = m.product_id
      )
      or pu.status = 'pedido'
      or (
        pu.status in ('cancelado', 'devuelto')
        and not exists (
          select 1
          from public.stock_movements r
          where r.purchase_id = m.purchase_id
            and r.product_id = m.product_id
            and r.id <> m.id
            and sign(r.quantity_delta) = -sign(m.quantity_delta)
        )
      )
    )
  )`;

const REVERSAL_MISMATCHES_SQL = `with sale_docs as (
  select
    s.id as document_id,
    s.store_id,
    s.status in ('cancelada', 'devuelta') as is_reverted,
    m.product_id,
    sum(case when m.type = 'venta' then m.quantity_delta else 0 end) as original_delta,
    sum(case when m.type in ('ajuste_entrada', 'devolucion_cliente') then m.quantity_delta else 0 end) as reversal_delta,
    sum(case when m.type = 'ajuste_entrada' then m.quantity_delta else 0 end) as cancel_delta
  from public.sales s
  join public.stock_movements m on m.sale_id = s.id
  group by s.id, s.store_id, s.status, m.product_id
),
purchase_docs as (
  select
    pu.id as document_id,
    pu.store_id,
    pu.status in ('cancelado', 'devuelto') as is_reverted,
    m.product_id,
    sum(case when m.type = 'compra' then m.quantity_delta else 0 end) as original_delta,
    sum(case when m.type in ('ajuste_salida', 'devolucion_proveedor') then m.quantity_delta else 0 end) as reversal_delta,
    sum(case when m.type = 'ajuste_salida' then m.quantity_delta else 0 end) as cancel_delta
  from public.purchases pu
  join public.stock_movements m on m.purchase_id = pu.id
  group by pu.id, pu.store_id, pu.status, m.product_id
)
select
  'sale'::text as document_type,
  d.document_id,
  d.store_id,
  d.product_id,
  d.original_delta::integer as original_delta,
  d.reversal_delta::integer as reversal_delta,
  case when d.is_reverted then 'reversal_mismatch' else 'reversal_on_live_document' end::text as issue
from sale_docs d
where (d.is_reverted and d.reversal_delta <> -d.original_delta)
   or (not d.is_reverted and (d.cancel_delta <> 0 or d.reversal_delta > -d.original_delta))
union all
select
  'purchase'::text as document_type,
  d.document_id,
  d.store_id,
  d.product_id,
  d.original_delta::integer as original_delta,
  d.reversal_delta::integer as reversal_delta,
  case when d.is_reverted then 'reversal_mismatch' else 'reversal_on_live_document' end::text as issue
from purchase_docs d
where (d.is_reverted and d.reversal_delta <> -d.original_delta)
   or (not d.is_reverted and (d.cancel_delta <> 0 or -d.reversal_delta > d.original_delta))`;

const CONVERSION_MISMATCHES_SQL = `with pairs as (
  select
    m.conversion_id,
    max(m.store_id::text)::uuid as movement_store_id,
    max(case when m.type = 'conversion_salida' then m.product_id::text end)::uuid as pack_product_id,
    max(case when m.type = 'conversion_entrada' then m.product_id::text end)::uuid as unit_product_id,
    sum(case when m.type = 'conversion_salida' then m.quantity_delta end) as pack_delta,
    sum(case when m.type = 'conversion_entrada' then m.quantity_delta end) as unit_delta
  from public.stock_movements m
  where m.conversion_id is not null
    and m.type in ('conversion_salida', 'conversion_entrada')
  group by m.conversion_id
),
linked as (
  select
    pr.*,
    coalesce(pp.store_id, up.store_id, pr.movement_store_id) as store_id,
    case
      when pr.pack_delta < 0 and pr.unit_delta > 0 and pr.unit_delta % (-pr.pack_delta) = 0
        then (pr.unit_delta / (-pr.pack_delta))::integer
    end as recorded_units_per_pack,
    (
      select c.units_per_pack
      from public.product_pack_conversions c
      where c.pack_product_id = pr.pack_product_id
        and c.unit_product_id = pr.unit_product_id
      order by c.is_active desc, c.updated_at desc nulls last, c.created_at desc
      limit 1
    ) as current_units_per_pack
  from pairs pr
  left join public.products pp on pp.id = pr.pack_product_id
  left join public.products up on up.id = pr.unit_product_id
)
select
  l.conversion_id,
  l.store_id,
  l.pack_product_id,
  l.unit_product_id,
  l.pack_delta::integer as pack_delta,
  l.unit_delta::integer as unit_delta,
  l.recorded_units_per_pack as units_per_pack,
  case
    when l.pack_product_id is null then 'missing_salida'
    when l.unit_product_id is null then 'missing_entrada'
    when l.current_units_per_pack is null then 'missing_link'
    else 'ratio_mismatch'
  end::text as issue,
  l.current_units_per_pack
from linked l
where l.pack_product_id is null
   or l.unit_product_id is null
   or l.current_units_per_pack is null
   or l.recorded_units_per_pack is null
   or l.recorded_units_per_pack < 2`;

const NEGATIVE_STOCK_SQL = `select
  'product'::text as source,
  p.id as product_id,
  p.store_id,
  null::uuid as movement_id,
  p.current_stock as value
from public.products p
where p.current_stock < 0
union all
select
  'movement'::text as source,
  m.product_id,
  coalesce(p.store_id, m.store_id) as store_id,
  m.id as movement_id,
  m.stock_after as value
from public.stock_movements m
left join public.products p on p.id = m.product_id
where m.stock_after < 0`;

const CROSS_STORE_MOVEMENTS_SQL = `select
  m.id as movement_id,
  m.store_id,
  p.store_id as product_store_id,
  coalesce(s.store_id, pu.store_id) as document_store_id,
  m.product_id,
  m.sale_id,
  m.purchase_id
from public.stock_movements m
left join public.products p on p.id = m.product_id
left join public.sales s on s.id = m.sale_id
left join public.purchases pu on pu.id = m.purchase_id
where m.store_id is distinct from p.store_id
   or (s.id is not null and (m.store_id is distinct from s.store_id or p.store_id is distinct from s.store_id))
   or (pu.id is not null and (m.store_id is distinct from pu.store_id or p.store_id is distinct from pu.store_id))`;

/** Orden estable de la muestra de cada comprobacion (columnas de su SELECT). */
const SAMPLE_ORDER: Record<IntegrityViewName, string> = {
  stock_reconciliation: "v.sku, v.product_id",
  stock_chain_breaks: "v.product_id, v.created_at, v.movement_id",
  sales_without_movements: "v.sale_id, v.sale_item_id",
  purchases_without_movements: "v.purchase_id, v.purchase_item_id",
  movements_without_document: "v.movement_id",
  reversal_mismatches: "v.document_id, v.product_id",
  conversion_mismatches: "v.conversion_id",
  negative_stock: "v.product_id, v.movement_id",
  cross_store_movements: "v.movement_id",
};

export interface CheckPlan {
  /** SELECT inline de la comprobacion, o null si no es evaluable en esta base. */
  sql: string | null;
  /** Columnas requeridas que faltan (sql = null). */
  missing: string[];
  /** Degradaciones aplicadas (sql != null pero no identico a la vista v2). */
  degraded: string[];
}

export type CheckPlans = Record<IntegrityViewName, CheckPlan>;

export function chainOrderOf(caps: Capabilities): ChainOrder {
  return caps.columns.has("stock_movements.seq") ? "seq" : "created_at,id";
}

/** SELECT inline de cada comprobacion segun lo que la base tiene. Con todo presente = vistas v2. */
export function planChecks(caps: Capabilities): CheckPlans {
  const missingPack = PACK_COLUMNS.filter((column) => !caps.columns.has(column));
  const full: Record<IntegrityViewName, { sql: string; degraded: string[] }> = {
    stock_reconciliation: { sql: STOCK_RECONCILIATION_SQL, degraded: [] },
    stock_chain_breaks:
      chainOrderOf(caps) === "seq"
        ? { sql: CHAIN_BREAKS_BY_SEQ_SQL, degraded: [] }
        : { sql: CHAIN_BREAKS_BY_CREATED_AT_SQL, degraded: [`falta stock_movements.seq: ${CHAIN_ORDER_WARNING}`] },
    sales_without_movements: { sql: SALES_WITHOUT_MOVEMENTS_SQL, degraded: [] },
    purchases_without_movements:
      missingPack.length === 0
        ? { sql: purchasesWithoutMovementsSql(PACK_NORMALIZED_QUANTITY), degraded: [] }
        : {
            sql: purchasesWithoutMovementsSql("pi.quantity"),
            degraded: [`falta ${missingPack.join(", ")}: se compara contra purchase_items.quantity sin normalizar empaques`],
          },
    movements_without_document: { sql: MOVEMENTS_WITHOUT_DOCUMENT_SQL, degraded: [] },
    reversal_mismatches: { sql: REVERSAL_MISMATCHES_SQL, degraded: [] },
    conversion_mismatches: { sql: CONVERSION_MISMATCHES_SQL, degraded: [] },
    negative_stock: { sql: NEGATIVE_STOCK_SQL, degraded: [] },
    cross_store_movements: { sql: CROSS_STORE_MOVEMENTS_SQL, degraded: [] },
  };
  const plans = {} as CheckPlans;
  for (const name of INTEGRITY_VIEW_NAMES) {
    const missing = missingColumns(caps, REQUIRED_COLUMNS[name]);
    plans[name] =
      missing.length > 0 ? { sql: null, missing, degraded: [] } : { sql: full[name].sql, missing: [], degraded: full[name].degraded };
  }
  return plans;
}

const STORE_FILTER = "($1::uuid is null or v.store_id = $1)";

function countByStoreSql(select: string): string {
  return `select v.store_id, count(*)::int as n from (\n${select}\n) v where ${STORE_FILTER} group by v.store_id`;
}

/** Hasta $2 filas POR TIENDA, en orden estable. */
function sampleByStoreSql(name: IntegrityViewName, select: string): string {
  return `select r.* from (
  select v.*, row_number() over (partition by v.store_id order by ${SAMPLE_ORDER[name]}) as store_rank
  from (\n${select}\n) v
  where ${STORE_FILTER}
) r
where r.store_rank <= $2::int
order by r.store_id, r.store_rank`;
}

/**
 * Una fila por producto con diff <> 0 (las de stock_reconciliation) mas la fecha
 * de alta del producto y, si la cadena es evaluable, su PRIMERA rotura en el
 * orden disponible.
 */
function diffProductsSql(recon: string, chain: string | null, caps: Capabilities): string {
  const createdAt = caps.columns.has("products.created_at") ? "p.created_at" : "null::timestamptz";
  const head = `with recon as (\n${recon}\n)`;
  const tail = `from recon v
join public.products p on p.id = v.product_id
`;
  const end = `where ${STORE_FILTER}
order by abs(v.diff) desc, v.sku, v.product_id`;
  if (chain === null) {
    return `${head}
select
  v.*,
  ${createdAt} as product_created_at,
  null::uuid as first_break_movement_id,
  null::timestamptz as first_break_at,
  null::integer as first_break_expected_stock_after,
  null::integer as first_break_stock_after
${tail}${end}`;
  }
  const firstOrder = chainOrderOf(caps) === "seq" ? "b.seq" : "b.created_at, b.movement_id";
  return `${head},
breaks as (\n${chain}\n),
first_break as (
  select distinct on (b.product_id)
    b.product_id,
    b.movement_id,
    b.created_at,
    b.expected_stock_after,
    b.stock_after
  from breaks b
  order by b.product_id, ${firstOrder}
)
select
  v.*,
  ${createdAt} as product_created_at,
  f.movement_id as first_break_movement_id,
  f.created_at as first_break_at,
  f.expected_stock_after as first_break_expected_stock_after,
  f.stock_after as first_break_stock_after
${tail}left join first_break f on f.product_id = v.product_id
${end}`;
}

const STORES_SQL = "select v.id as store_id, v.name from public.stores v where ($1::uuid is null or v.id = $1) order by v.name";
const READ_ONLY_PROBE_SQL = "select current_setting('transaction_read_only') as read_only";

// ----------------------------------------------------------------- informe

export const WORST_LIMIT = 20;

export type FirstMismatch =
  | {
      kind: "chain_break";
      at: string | null;
      movementId: string;
      expectedStockAfter: number;
      stockAfter: number;
      order: ChainOrder;
    }
  | { kind: "no_chain_break"; note: typeof NO_CHAIN_BREAK_LABEL; productCreatedAt: string | null; lastMovementAt: string | null }
  | { kind: "not_evaluable"; reason: string };

export interface DiffProduct {
  storeId: string | null;
  productId: string;
  sku: string;
  name: string;
  currentStock: number;
  ledgerStock: number;
  diff: number;
  firstMismatch: FirstMismatch;
}

export interface CheckStatus {
  evaluable: boolean;
  /** Filas de la comprobacion en el alcance pedido; null si no es evaluable. */
  count: number | null;
  /** "no evaluable: falta <columnas>" cuando evaluable = false. */
  reason: string | null;
  degraded: string[];
}

export interface ScopeSummary {
  storeId: string | null;
  storeName: string;
  counts: Record<IntegrityViewName, number | null>;
  /** Suma de |diff| de los productos con diff <> 0; null si stock_reconciliation no es evaluable. */
  absDiffSum: number | null;
  /** Los WORST_LIMIT productos con mayor |diff|. */
  worst: DiffProduct[];
}

export type RowsByView = Record<IntegrityViewName, Row[]>;

export interface ReadOnlyReport {
  chainOrder: ChainOrder;
  warnings: string[];
  integrityViewsPresent: IntegrityViewName[];
  checks: Record<IntegrityViewName, CheckStatus>;
  total: ScopeSummary;
  stores: ScopeSummary[];
  /** Todos los productos con diff <> 0, con la fecha de su primer descuadre. */
  diffProducts: DiffProduct[];
  /** Muestra por comprobacion: hasta `limit` filas por tienda. */
  rows: RowsByView;
}

export interface ReadOnlyOptions {
  storeId: string | null;
  /** Filas de muestra por comprobacion y tienda (0 = sin muestras). */
  limit: number;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function toId(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toDiffProduct(row: Row, chain: CheckPlan, order: ChainOrder): DiffProduct {
  let firstMismatch: FirstMismatch;
  const movementId = toId(row.first_break_movement_id);
  if (chain.sql === null) {
    firstMismatch = { kind: "not_evaluable", reason: `no evaluable: falta ${chain.missing.join(", ")}` };
  } else if (movementId !== null) {
    firstMismatch = {
      kind: "chain_break",
      at: toIso(row.first_break_at),
      movementId,
      expectedStockAfter: toNumber(row.first_break_expected_stock_after),
      stockAfter: toNumber(row.first_break_stock_after),
      order,
    };
  } else {
    firstMismatch = {
      kind: "no_chain_break",
      note: NO_CHAIN_BREAK_LABEL,
      productCreatedAt: toIso(row.product_created_at),
      lastMovementAt: toIso(row.last_movement_at),
    };
  }
  return {
    storeId: toId(row.store_id),
    productId: String(row.product_id),
    sku: String(row.sku ?? ""),
    name: String(row.name ?? ""),
    currentStock: toNumber(row.current_stock),
    ledgerStock: toNumber(row.ledger_stock),
    diff: toNumber(row.diff),
    firstMismatch,
  };
}

const VIEW_ONLY_KEYS = new Set([
  "product_created_at",
  "first_break_movement_id",
  "first_break_at",
  "first_break_expected_stock_after",
  "first_break_stock_after",
  "store_rank",
]);

/** Quita las columnas auxiliares del informe: deja la fila como la daria la vista. */
function viewRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !VIEW_ONLY_KEYS.has(key)));
}

const NO_STORE_KEY = "";

function summarize(
  storeId: string | null,
  storeName: string,
  counts: Record<IntegrityViewName, number | null>,
  products: readonly DiffProduct[],
): ScopeSummary {
  return {
    storeId,
    storeName,
    counts,
    absDiffSum: counts.stock_reconciliation === null ? null : products.reduce((acc, p) => acc + Math.abs(p.diff), 0),
    worst: products.slice(0, WORST_LIMIT),
  };
}

/**
 * Ejecuta las comprobaciones con `query` (ya guardado) y arma el informe. No
 * abre ni cierra transaccion: sirve con un cliente que ya esta dentro de una.
 */
export async function collectReadOnlyReport(query: ReadOnlyQuery, options: ReadOnlyOptions): Promise<ReadOnlyReport> {
  const caps = await detectCapabilities(query);
  const plans = planChecks(caps);
  const order = chainOrderOf(caps);
  const storeParam = [options.storeId];

  const storeNames = new Map<string, string>();
  if (caps.columns.has("stores.id") && caps.columns.has("stores.name")) {
    for (const row of await query(STORES_SQL, storeParam)) storeNames.set(String(row.store_id), String(row.name));
  }

  const checks = {} as Record<IntegrityViewName, CheckStatus>;
  const rows = {} as RowsByView;
  const perStore = new Map<string, Partial<Record<IntegrityViewName, number>>>();
  const bump = (storeId: string | null, name: IntegrityViewName, n: number) => {
    const key = storeId ?? NO_STORE_KEY;
    const entry = perStore.get(key) ?? {};
    entry[name] = (entry[name] ?? 0) + n;
    perStore.set(key, entry);
  };
  for (const id of storeNames.keys()) perStore.set(id, {});

  let diffProducts: DiffProduct[] = [];
  for (const name of INTEGRITY_VIEW_NAMES) {
    const plan = plans[name];
    rows[name] = [];
    if (plan.sql === null) {
      checks[name] = { evaluable: false, count: null, reason: `no evaluable: falta ${plan.missing.join(", ")}`, degraded: [] };
      continue;
    }
    let count = 0;
    if (name === "stock_reconciliation") {
      const detail = await query(diffProductsSql(plan.sql, plans.stock_chain_breaks.sql, caps), storeParam);
      diffProducts = detail.map((row) => toDiffProduct(row, plans.stock_chain_breaks, order));
      const taken = new Map<string, number>();
      for (const row of detail) {
        const storeId = toId(row.store_id);
        bump(storeId, name, 1);
        const used = taken.get(storeId ?? NO_STORE_KEY) ?? 0;
        if (used < options.limit) rows[name].push(viewRow(row));
        taken.set(storeId ?? NO_STORE_KEY, used + 1);
      }
      count = detail.length;
    } else {
      for (const row of await query(countByStoreSql(plan.sql), storeParam)) {
        bump(toId(row.store_id), name, toNumber(row.n));
        count += toNumber(row.n);
      }
      if (count > 0 && options.limit > 0) {
        rows[name] = (await query(sampleByStoreSql(name, plan.sql), [options.storeId, options.limit])).map(viewRow);
      }
    }
    checks[name] = { evaluable: true, count, reason: null, degraded: plan.degraded };
  }

  const countsFor = (entry: Partial<Record<IntegrityViewName, number>> | null) => {
    const counts = {} as Record<IntegrityViewName, number | null>;
    for (const name of INTEGRITY_VIEW_NAMES) {
      counts[name] = !checks[name].evaluable ? null : entry === null ? checks[name].count : (entry[name] ?? 0);
    }
    return counts;
  };
  const stores = [...perStore.entries()]
    .map(([key, entry]) => {
      const storeId = key === NO_STORE_KEY ? null : key;
      const storeName = storeId === null ? "(sin tienda)" : (storeNames.get(storeId) ?? storeId);
      return summarize(storeId, storeName, countsFor(entry), diffProducts.filter((p) => p.storeId === storeId));
    })
    .sort((a, b) => a.storeName.localeCompare(b.storeName));

  const warnings: string[] = [];
  for (const name of INTEGRITY_VIEW_NAMES) {
    const reason = checks[name].reason;
    if (reason !== null) warnings.push(`${name}: ${reason}`);
    for (const note of checks[name].degraded) warnings.push(`${name}: ${note}`);
  }
  if (plans.stock_reconciliation.sql !== null && !caps.columns.has("products.created_at")) {
    warnings.push("falta products.created_at: sin fecha de alta en los productos con diff sin rotura de cadena");
  }

  return {
    chainOrder: order,
    warnings,
    integrityViewsPresent: caps.integrityViews,
    checks,
    total: summarize(options.storeId, "total", countsFor(null), diffProducts),
    stores,
    diffProducts,
    rows,
  };
}

/** Sesion completa sobre un cliente recien conectado: BEGIN READ ONLY -> comprobaciones -> ROLLBACK siempre. */
export async function runReadOnlySession(client: QueryClient, options: ReadOnlyOptions): Promise<ReadOnlyReport> {
  const query = createReadOnlyQuery(client);
  await query(BEGIN_READ_ONLY);
  try {
    const probe = await query(READ_ONLY_PROBE_SQL);
    if (probe[0]?.read_only !== "on") {
      throw new Error("La transaccion no quedo en modo READ ONLY: se aborta sin ejecutar ninguna comprobacion.");
    }
    return await collectReadOnlyReport(query, options);
  } finally {
    await query(ROLLBACK);
  }
}

export interface ProductionConnection {
  client: QueryClient & { end(): Promise<void> };
  host: string;
}

export interface ProductionRun {
  host: string;
  report: ReadOnlyReport;
}

/**
 * Camino de `--target production`. Sin `--read-only` lanza ANTES de llamar a
 * `connect` (no se abre ninguna conexion).
 */
export async function runProductionReadOnly(
  args: ReconcileArgs,
  connect: () => Promise<ProductionConnection>,
): Promise<ProductionRun> {
  assertProductionReadOnly(args);
  const { client, host } = await connect();
  try {
    return { host, report: await runReadOnlySession(client, { storeId: args.storeId, limit: args.limit }) };
  } finally {
    await client.end();
  }
}

/** Conteos en el formato del oraculo lab (las no evaluables cuentan 0; su estado real esta en `checks`). */
export function integrityReportOf(report: ReadOnlyReport): IntegrityReport {
  const counts: Partial<Record<IntegrityViewName, number>> = {};
  for (const name of INTEGRITY_VIEW_NAMES) counts[name] = report.checks[name].count ?? 0;
  return buildReportFromCounts(counts);
}

// ---------------------------------------------------------------- markdown

export interface ReadOnlyReportMeta {
  runId: string;
  host: string;
  storeId: string | null;
  generatedAt: string;
  limit: number;
}

function cell(value: string | number | null): string {
  return value === null ? "-" : String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

function describeFirstMismatch(first: FirstMismatch): string {
  if (first.kind === "chain_break") {
    return `${first.at ?? "sin fecha"}: mov ${first.movementId} dejo stock_after ${first.stockAfter}, esperado ${first.expectedStockAfter} (orden ${first.order})`;
  }
  if (first.kind === "no_chain_break") {
    return `${first.note} (alta del producto ${first.productCreatedAt ?? "desconocida"}, ultimo movimiento ${first.lastMovementAt ?? "ninguno"})`;
  }
  return first.reason;
}

function scopeSection(scope: ScopeSummary, title: string, report: ReadOnlyReport, withSamples: boolean): string[] {
  const lines = [`## ${title}`, "", "| comprobacion | filas | estado |", "|---|---:|---|"];
  for (const name of INTEGRITY_VIEW_NAMES) {
    const count = scope.counts[name];
    const state = count === null ? (report.checks[name].reason ?? "no evaluable") : count === 0 ? "OK" : "FAIL";
    lines.push(`| ${name} | ${cell(count)} | ${cell(state)} |`);
  }
  lines.push(
    "",
    `- Productos con diff != 0: ${cell(scope.counts.stock_reconciliation)}`,
    `- Suma absoluta del diff: ${cell(scope.absDiffSum)}`,
    `- Cadenas rotas (movimientos): ${cell(scope.counts.stock_chain_breaks)}`,
    `- Ventas sin movimiento (lineas): ${cell(scope.counts.sales_without_movements)}`,
    `- Compras recibidas sin movimiento (lineas): ${cell(scope.counts.purchases_without_movements)}`,
  );
  if (scope.worst.length > 0) {
    lines.push(
      "",
      `### Los ${scope.worst.length} peores (por |diff|)`,
      "",
      "| sku | nombre | current_stock | suma movimientos | diff | primer descuadre |",
      "|---|---|---:|---:|---:|---|",
    );
    for (const p of scope.worst) {
      lines.push(
        `| ${cell(p.sku)} | ${cell(p.name)} | ${p.currentStock} | ${p.ledgerStock} | ${p.diff} | ${cell(describeFirstMismatch(p.firstMismatch))} |`,
      );
    }
  }
  if (withSamples) {
    for (const name of INTEGRITY_VIEW_NAMES) {
      if (name === "stock_reconciliation") continue;
      const sample = report.rows[name].filter((row) => toId(row.store_id) === scope.storeId);
      if (sample.length === 0) continue;
      lines.push("", `### Muestra de ${name} (${cell(scope.counts[name])} filas, mostrando ${sample.length})`, "", "```json");
      for (const row of sample) lines.push(JSON.stringify(row));
      lines.push("```");
    }
  }
  lines.push("");
  return lines;
}

/** Informe legible (plan 8.4): total y por tienda. */
export function formatReadOnlyMarkdown(meta: ReadOnlyReportMeta, report: ReadOnlyReport): string {
  const present = report.integrityViewsPresent;
  const lines = [
    "# Informe de inventario (solo lectura)",
    "",
    `- Run: ${meta.runId}`,
    `- Generado: ${meta.generatedAt}`,
    `- Host: ${meta.host}`,
    `- Alcance: ${meta.storeId ?? "todas las tiendas"}`,
    "- Sesion: una transaccion READ ONLY (repeatable read) terminada en ROLLBACK; solo SELECT, ningun objeto creado.",
    `- Orden de la cadena: ${report.chainOrder}`,
    `- Vistas de integridad ya presentes en la base (no se usan): ${present.length > 0 ? present.join(", ") : "ninguna"}`,
    `- Muestras: hasta ${meta.limit} filas por comprobacion y tienda`,
    "",
  ];
  if (report.warnings.length > 0) {
    lines.push("## Avisos", "", ...report.warnings.map((warning) => `- ${warning}`), "");
  }
  lines.push(...scopeSection(report.total, "Total", report, false));
  for (const store of report.stores) {
    lines.push(...scopeSection(store, `Tienda: ${store.storeName} (${store.storeId ?? "sin id"})`, report, true));
  }
  return `${lines.join("\n")}\n`;
}
