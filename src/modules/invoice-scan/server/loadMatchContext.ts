/**
 * SCN-05b · Arma el `MatchContext` de `matchInvoice` desde la base (plan
 * factura-escaneo-gtm §3 "Emparejamiento", "Proveedor del documento",
 * "Unidades y empaques", "Moneda y alícuota").
 *
 * Tres tandas de consultas, cada una en paralelo y TODAS con filtro explícito
 * por `storeId` (la tienda del servidor, nunca la del cliente):
 * 1. RPC `invoice_match_candidates` (20261019d: proveedores por RIF / trigram,
 *    proveedor más probable y candidatos difusos por línea), alícuotas
 *    (`tax_rates_for_store` + `app_settings.default_tax_rate_id`), tasa del día
 *    (`getCurrentExchangeRate`, la del formulario de compra), escaneos previos con el mismo número
 *    (`invoice_match_previous_scans`) y productos por código de barras (`invoice_match_barcode_products`).
 * 2. Catálogo del proveedor elegido por la RPC: `supplier_products` activos con
 *    sus `supplier_product_pack_units` activos (paginados), los alias exactos de la
 *    factura (`invoice_match_exact_aliases`) y los de los productos casados por SKU (C6-M3); en
 *    paralelo, la misma RPC con textos limpios (`searchTextVariants`) para las
 *    líneas que no trajeron ningún candidato difuso.
 * 3. Detalle de los productos referenciados (candidatos + catálogo + alias +
 *    barcode): alícuota de la categoría, receta activa, tamaños de las recetas
 *    de las que es componente y último costo recibido (o `current_cost_ref`, D24-c).
 *
 * D35 (P8-M1): ningún texto de la factura (claves de alias, barcodes, número,
 * fecha) va en la URL: viaja en el cuerpo POST de las RPC (20261019q). Las
 * consultas por URL filtran solo por ids internos.
 */
import { normalizeAlias } from "@bodega/core/invoice";
import { invoiceAliasKey } from "../invoiceAliasKey";

import { throwIfSupabaseError } from "@/lib/supabase/errors";
import type { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { readCurrentExchangeRate } from "@/modules/settings/services/exchangeRates.server";

import type { InvoiceExtraction } from "../contracts";

import type {
  InvoiceLastUnitCost,
  MatchAlias,
  MatchContext,
  MatchFuzzyCandidate,
  MatchPackUnit,
  MatchPreviousScan,
  MatchProduct,
  MatchSupplierCandidate,
  MatchSupplierCatalog,
  MatchSupplierProduct,
  MatchTaxRate,
  MatchTaxRateKind,
} from "./match.types";
import { lastUnitCostRefOf } from "./match/money";
import { searchTextVariants } from "./match/searchText";
import { exactAliasTexts } from "./match/product";
import { resolveSupplier } from "./match/supplier";
import { invoiceDateKey, normalizeCode, normalizeInvoiceNumber, normalizeTaxId } from "./match/text";

/** Mismo cliente que usan los `*.server.ts` (sesión del usuario: `auth.uid()` para la RPC). */
export type MatchContextSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

/** Nombre de la RPC de candidatos (20261019d). */
export const MATCH_CANDIDATES_RPC = "invoice_match_candidates";
/** Candidatos difusos por línea pedidos a la RPC (la RPC acota a 5). */
export const MATCH_CANDIDATES_PER_LINE = 5;
/** Textos máximos por llamada a la RPC (por encima responde PT400). */
export const MATCH_CANDIDATES_MAX_TEXTS = 500;
/** RPC de alias exactos del proveedor (20261019q). */
export const MATCH_EXACT_ALIASES_RPC = "invoice_match_exact_aliases";
/** RPC de productos por código de barras (20261019q). */
export const MATCH_BARCODE_PRODUCTS_RPC = "invoice_match_barcode_products";
/** RPC de escaneos previos por número o por fecha y total (20261019q). */
export const MATCH_PREVIOUS_SCANS_RPC = "invoice_match_previous_scans";
/**
 * REP12-06 (B-qa-rep12-01-1): la misma búsqueda con el proveedor filtrado ANTES del tope
 * (20261026a); la usa `POST /api/purchases/invoice-scan/duplicates`.
 */
export const DUPLICATE_CANDIDATES_RPC = "invoice_duplicate_candidates";
/** Escaneos previos con el mismo número normalizado que se pasan a `matchInvoice`. */
export const PREVIOUS_SCANS_LIMIT = 50;
/** Candidatos que se piden a la base antes de filtrar por número normalizado. */
export const PREVIOUS_SCAN_CANDIDATES_LIMIT = 200;

/**
 * Filas por página: el `max_rows` de PostgREST (supabase/config.toml). Una
 * respuesta nunca trae más; toda lectura que pueda pasar de aquí se pagina con
 * `order` estable (C6-M3, D33-c).
 */
export const POSTGREST_PAGE_SIZE = 1000;
/** Valores por filtro `in` (URL acotada); cada lote se pagina aparte. */
export const IN_FILTER_CHUNK_SIZE = 150;

const PRODUCT_SELECT =
  "id, name, sku, barcode, is_active, current_cost_ref, category:categories(tax_rate:tax_rates(code))";
/** Igual que `purchaseLastCosts.server.ts`: la última línea recibida de cada producto. */
const LAST_LINE_SELECT = "id, purchase_items(unit_cost_ref, purchases!inner(created_at))";
const SUPPLIER_PRODUCT_SELECT =
  "id, product_id, supplier_sku, is_preferred, supplier_product_pack_units(id, label, units_per_pack, is_default, is_active)";

type CandidatesRpcResult = {
  suppliers?: Array<{
    contact_id: string;
    name: string;
    tax_id: string | null;
    score: number | string | null;
    tax_id_match?: boolean;
  }>;
  supplier_id?: string | null;
  lines?: Array<{ ordinal: number; product_id: string; score: number | string; via: string }>;
};

type TaxRateRow = { id: string; code: string; pct: number | string; is_active: boolean };

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  is_active: boolean;
  current_cost_ref?: number | string | null;
  category: { tax_rate: { code: string } | null } | null;
};

type SupplierProductRow = {
  id: string;
  product_id: string;
  supplier_sku: string | null;
  is_preferred: boolean | null;
  supplier_product_pack_units: Array<{
    id: string;
    label: string;
    units_per_pack: number;
    is_default: boolean | null;
    is_active: boolean;
  }> | null;
};

type AliasRow = {
  id: string;
  alias_norm: string;
  product_id: string;
  pack_label: string | null;
  units_per_pack: number | null;
  hits: number;
};

type LastLineRow = {
  id: string;
  purchase_items: Array<{ unit_cost_ref: number | string }> | null;
};

/** Lo que la búsqueda de escaneos previos usa de la factura (o de la revisión). */
type DuplicateKeys = Pick<InvoiceExtraction, "number" | "date" | "total">;

/**
 * REP12-06 (B-qa-rep12-01-1): proveedor de la consulta de duplicados (ids elegido / leído y RIF
 * leído / guardado). Con él, la base filtra por proveedor antes del tope de candidatos; la regla
 * exacta sigue siendo `findDuplicateScans`.
 */
export type DuplicateSupplierFilter = {
  ids: (string | null | undefined)[];
  taxIds: (string | null | undefined)[];
};

/**
 * REP12-06: proveedor LEÍDO para los escaneos previos del emparejamiento, con lo mismo que
 * `matchInvoice` pasa a `findDuplicateScan`: el contacto que resuelve `resolveSupplier`, su RIF
 * guardado y el RIF leído. Sin contacto resuelto ni RIF leído, `undefined` (búsqueda sin filtro de
 * proveedor, como antes).
 */
export function readDuplicateSupplier(
  extraction: Pick<InvoiceExtraction, "supplier">,
  supplierCandidates: MatchSupplierCandidate[],
): DuplicateSupplierFilter | undefined {
  const contactId = resolveSupplier(extraction.supplier, supplierCandidates).contactId;
  if (!contactId && !normalizeTaxId(extraction.supplier.taxId)) {
    return undefined;
  }
  return {
    ids: [contactId],
    taxIds: [extraction.supplier.taxId, supplierCandidates.find((candidate) => candidate.contactId === contactId)?.taxId],
  };
}

/** Parámetros de `invoice_duplicate_candidates`: ids únicos y dígitos de RIF (`normalizeTaxId`). */
export function duplicateSupplierParams(filter: DuplicateSupplierFilter): {
  p_supplier_ids: string[];
  p_tax_digits: string[];
} {
  const ids = filter.ids.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id));
  const digits = filter.taxIds.map(normalizeTaxId).filter((value) => /^[A-Z0-9]{1,20}$/.test(value));
  return { p_supplier_ids: [...new Set(ids)].slice(0, 10), p_tax_digits: [...new Set(digits)].slice(0, 10) };
}

type PreviousScanRow = {
  id: string;
  supplier_id: string | null;
  /** REP14-01 (D63): número EFECTIVO (confirmado si no está vacío, si no el leído). */
  number: string | null;
  /** REP14-01: número LEÍDO (`extracted->number`). */
  read_number?: string | null;
  supplier_tax_id: string | null;
  matched_contact_id: string | null;
  /** REP14-05: fecha y total EFECTIVOS (confirmados si no están vacíos, si no los leídos). */
  date?: string | null;
  total?: number | string | null;
  /** REP14-05: fecha y total LEÍDOS (`extracted->date`, `extracted->total`). */
  read_date?: string | null;
  read_total?: number | string | null;
  purchase_id?: string | null;
  purchase?: { status: string | null } | null;
};

const EMPTY_CATALOG: MatchSupplierCatalog = { supplierProducts: [], aliases: [], packUnits: [] };

function toNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveCost(value: number | string | null | undefined): number | undefined {
  const cost = toNumber(value);
  return cost !== undefined && cost > 0 ? cost : undefined;
}

type PageResult = { data: unknown[] | null; error: unknown };

/**
 * Todas las filas de una consulta, página a página (`range`). `page` debe
 * llevar un `order` por una columna única para que las páginas no se solapen.
 */
async function fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await page(from, from + POSTGREST_PAGE_SIZE - 1);
    throwIfSupabaseError(error);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < POSTGREST_PAGE_SIZE) {
      return rows;
    }
  }
}

/** `fetchAllPages` por lotes de valores del filtro `in` (en paralelo). */
async function fetchAllIn<T>(
  values: string[],
  page: (chunk: string[], from: number, to: number) => PromiseLike<PageResult>,
): Promise<T[]> {
  const unique = [...new Set(values)];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += IN_FILTER_CHUNK_SIZE) {
    chunks.push(unique.slice(start, start + IN_FILTER_CHUNK_SIZE));
  }
  const results = await Promise.all(chunks.map((chunk) => fetchAllPages<T>((from, to) => page(chunk, from, to))));
  return results.flat();
}

/** Clasifica la alícuota para leer el `taxHint`: por código semilla (20261007a) y, si no, por porcentaje. */
export function taxRateKind(code: string, pct: number): MatchTaxRateKind {
  if (code === "exento" || code === "reducida" || code === "general") {
    return code;
  }
  if (pct === 0) {
    return "exento";
  }
  if (pct === 8) {
    return "reducida";
  }
  if (pct === 16) {
    return "general";
  }
  return "otra";
}

/** Barcodes leídos tal cual y en solo dígitos (la base puede guardarlos sin espacios ni guiones). */
function barcodeVariants(extraction: InvoiceExtraction): string[] {
  const values = extraction.lines.flatMap((line) => {
    const raw = line.barcode?.trim();
    if (!raw) {
      return [];
    }
    const compact = raw.replace(/[^0-9A-Za-z]/g, "");
    return compact && compact !== raw ? [raw, compact] : [raw];
  });
  return [...new Set(values)];
}

async function loadCandidates(
  supabase: MatchContextSupabaseClient,
  extraction: InvoiceExtraction,
): Promise<CandidatesRpcResult> {
  const { data, error } = await supabase.rpc(MATCH_CANDIDATES_RPC, {
    p_supplier_name: normalizeAlias(extraction.supplier.name ?? ""),
    p_supplier_tax_id: extraction.supplier.taxId ?? null,
    // Alias difusos contra la clave con la que se aprenden (SCN-UI-Q2), no el rawText entero.
    p_texts: extraction.lines.map((line) => invoiceAliasKey(line)),
    p_descriptions: extraction.lines.map((line) => normalizeAlias(line.description || line.rawText)),
    p_limit: MATCH_CANDIDATES_PER_LINE,
  });
  throwIfSupabaseError(error);
  return (data ?? {}) as CandidatesRpcResult;
}

async function loadTaxRates(supabase: MatchContextSupabaseClient, storeId: string): Promise<MatchTaxRate[]> {
  const [rates, settings] = await Promise.all([
    supabase.rpc("tax_rates_for_store", { p_store_id: storeId }),
    supabase.from("app_settings").select("default_tax_rate_id").eq("store_id", storeId).maybeSingle(),
  ]);
  throwIfSupabaseError(rates.error);
  throwIfSupabaseError(settings.error);

  const defaultId = (settings.data as { default_tax_rate_id: string | null } | null)?.default_tax_rate_id ?? null;
  return ((rates.data ?? []) as TaxRateRow[])
    .filter((row) => row.is_active)
    .map((row) => {
      const pct = toNumber(row.pct) ?? 0;
      return { code: row.code, pct, kind: taxRateKind(row.code, pct), isDefault: row.id === defaultId };
    });
}

/**
 * Tasa del día: la MISMA que usa el formulario de compra para la conversión
 * Bs<->REF (`useCurrentExchangeRate` -> `/api/exchange-rates/current` ->
 * `getCurrentExchangeRate`: DolarAPI oficial con caché de proceso), para que la
 * coherencia de precio y el costo precargado cuadren con el formulario (CIE-02).
 * El escaneo solo la LEE (`readCurrentExchangeRate`, D24-b): no inserta en
 * `exchange_rates`; persistirla queda en el flujo del formulario.
 * Si DolarAPI falla, el formulario se queda sin tasa del día (la ruta responde
 * error, no cae a la última guardada); aquí igual: `undefined`, y `matchInvoice`
 * aplica 6.7 (tasa impresa con aviso o, sin ella, sin costos REF y con aviso).
 */
async function loadSystemRate(): Promise<number | undefined> {
  try {
    const { rateVes } = await readCurrentExchangeRate();
    return Number.isFinite(rateVes) && rateVes > 0 ? rateVes : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Escaneos de la tienda con el MISMO número normalizado (`normalizeInvoiceNumber`
 * en ambos lados, como `findDuplicateScan`): "FAC12321" = "FAC-12321",
 * "1004321" = "0001-004321". El texto guardado es crudo, así que la base trae
 * candidatos cuyo número contiene los caracteres normalizados en orden y
 * termina en el último (`%F%A%C%1%2%3%2%1`, sin distinguir mayúsculas; los
 * separadores y ceros sobrantes caen en los `%`) y aquí se filtra por igualdad
 * normalizada. `findDuplicateScan` decide después por proveedor/RIF. Los
 * descartados o fallidos no cuentan. Se suman los del posible duplicado
 * (`loadPreviousScansByDateTotal`), con fecha y total leídos o confirmados (REP14-05). REP12-01 (D53): también la usa
 * `POST /api/purchases/invoice-scan/duplicates` con el número, la fecha y el total de la revisión.
 * REP12-01 (D53): cada escaneo lleva el RIF guardado de su proveedor elegido y de su contacto
 * leído (`loadContactTaxIds`, contactos de la tienda).
 * REP12-06 (B-qa-rep12-01-1): con `supplier`, la base filtra por proveedor antes del tope
 * (`invoice_duplicate_candidates`); sin ningún id ni RIF usable no hay candidatos.
 */
export async function loadPreviousScans(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  extraction: DuplicateKeys,
  excludeScanId?: string,
  supplier?: DuplicateSupplierFilter,
): Promise<MatchPreviousScan[]> {
  const supplierParams = supplier ? duplicateSupplierParams(supplier) : undefined;
  if (supplierParams && supplierParams.p_supplier_ids.length + supplierParams.p_tax_digits.length === 0) {
    return [];
  }
  const [byNumber, byDateTotal] = await Promise.all([
    loadPreviousScansByNumber(supabase, extraction, excludeScanId, supplierParams),
    loadPreviousScansByDateTotal(supabase, extraction, excludeScanId, supplierParams),
  ]);
  const seen = new Set(byNumber.map((row) => row.id));
  const rows = [...byNumber, ...byDateTotal.filter((row) => !seen.has(row.id))];
  const taxIds = await loadContactTaxIds(
    supabase,
    storeId,
    rows.flatMap((row) => [row.supplier_id, row.matched_contact_id]),
  );
  return rows.map((row) => ({
    scanId: row.id,
    supplierId: row.supplier_id ?? row.matched_contact_id ?? null,
    matchedContactId: row.matched_contact_id ?? undefined,
    supplierTaxId: row.supplier_tax_id ?? null,
    ...contactTaxIdsOf(taxIds, [row.supplier_id, row.matched_contact_id]),
    number: row.number ?? null,
    readNumber: row.read_number ?? undefined,
    date: row.date ?? undefined,
    readDate: row.read_date ?? undefined,
    total: toNumber(row.total),
    readTotal: toNumber(row.read_total),
    purchaseId: row.purchase_id ?? undefined,
    purchaseStatus: row.purchase?.status ?? undefined,
  }));
}

/**
 * REP12-01 (D53): RIF guardado (`contacts.tax_id`) de los contactos de la tienda, por id. Solo
 * ids internos en la URL (D35); los que no son uuid no pueden ser contactos y no se piden.
 */
export async function loadContactTaxIds(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id)))];
  const taxIds = new Map<string, string>();
  for (let start = 0; start < unique.length; start += IN_FILTER_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, tax_id")
      .eq("store_id", storeId)
      .in("id", unique.slice(start, start + IN_FILTER_CHUNK_SIZE));
    throwIfSupabaseError(error);
    for (const row of (data ?? []) as { id: string; tax_id: string | null }[]) {
      if (row.tax_id?.trim()) {
        taxIds.set(row.id, row.tax_id);
      }
    }
  }
  return taxIds;
}

/** `contactTaxIds` de un escaneo previo (sin la clave si ninguno de sus contactos tiene RIF). */
export function contactTaxIdsOf(
  taxIds: ReadonlyMap<string, string>,
  ids: (string | null | undefined)[],
): { contactTaxIds?: string[] } {
  const found = [...new Set(ids.flatMap((id) => (id && taxIds.has(id) ? [taxIds.get(id) as string] : [])))];
  return found.length > 0 ? { contactTaxIds: found } : {};
}

/**
 * Posible duplicado (caos 5.4, `findDuplicateScan`): escaneos con el mismo
 * total leído o confirmado (±0,01; REP14-05) y, si se leyó, la misma fecha. Solo hace falta si el
 * número falta o puede estar mal leído; con número y sin fecha no aplica.
 * `extracted->>total` es el texto del número JSON (lo que da `String(n)` en
 * JS), así que se piden las tres variantes al céntimo. El proveedor lo decide
 * `findDuplicateScan`.
 */
async function loadPreviousScansByDateTotal(
  supabase: MatchContextSupabaseClient,
  extraction: DuplicateKeys,
  excludeScanId?: string,
  supplierParams?: ReturnType<typeof duplicateSupplierParams>,
): Promise<PreviousScanRow[]> {
  const total = extraction.total;
  // REP15-02 (B-p16-1): la fecha va como clave ISO sin blancos Unicode, como la compara la regla.
  const date = invoiceDateKey(extraction.date);
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    return [];
  }
  if (!date && normalizeInvoiceNumber(extraction.number)) {
    return [];
  }

  const cents = Math.round(total * 100);
  const totals = [cents - 1, cents, cents + 1].map((value) => String(value / 100));
  const { data, error } = await supabase.rpc(supplierParams ? DUPLICATE_CANDIDATES_RPC : MATCH_PREVIOUS_SCANS_RPC, {
    p_totals: totals,
    p_date: date || null,
    p_exclude_scan_id: excludeScanId ?? null,
    p_limit: PREVIOUS_SCANS_LIMIT,
    ...supplierParams,
  });
  throwIfSupabaseError(error);
  return (data ?? []) as PreviousScanRow[];
}

async function loadPreviousScansByNumber(
  supabase: MatchContextSupabaseClient,
  extraction: DuplicateKeys,
  excludeScanId?: string,
  supplierParams?: ReturnType<typeof duplicateSupplierParams>,
): Promise<PreviousScanRow[]> {
  const number = normalizeInvoiceNumber(extraction.number);
  if (!number) {
    return [];
  }

  // La RPC busca `%F%A%C%1` (los caracteres en orden) con `number` en el cuerpo POST.
  const { data, error } = await supabase.rpc(supplierParams ? DUPLICATE_CANDIDATES_RPC : MATCH_PREVIOUS_SCANS_RPC, {
    p_number: number,
    p_exclude_scan_id: excludeScanId ?? null,
    p_limit: PREVIOUS_SCAN_CANDIDATES_LIMIT,
    ...supplierParams,
  });
  throwIfSupabaseError(error);

  return ((data ?? []) as PreviousScanRow[])
    // REP14-01: casa el número efectivo o el leído (la RPC filtra por cualquiera de los dos).
    .filter((row) => [row.number, row.read_number].some((value) => normalizeInvoiceNumber(value) === number))
    .slice(0, PREVIOUS_SCANS_LIMIT);
}

async function loadProductsByIds(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  ids: string[],
): Promise<ProductRow[]> {
  return fetchAllIn<ProductRow>(ids, (chunk, from, to) =>
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("store_id", storeId)
      .in("id", chunk)
      .order("id")
      .range(from, to),
  );
}

/** ids de los productos con alguno de los barcodes leídos (RPC por POST, D35). */
async function loadBarcodeProductIds(
  supabase: MatchContextSupabaseClient,
  extraction: InvoiceExtraction,
): Promise<string[]> {
  const barcodes = barcodeVariants(extraction);
  if (barcodes.length === 0) {
    return [];
  }
  const { data, error } = await supabase.rpc(MATCH_BARCODE_PRODUCTS_RPC, { p_barcodes: barcodes });
  throwIfSupabaseError(error);
  return (data ?? []) as string[];
}

/** Alias del proveedor con alguna de las claves exactas de la factura (RPC por POST, D35). */
async function loadExactAliases(
  supabase: MatchContextSupabaseClient,
  supplierId: string,
  extraction: InvoiceExtraction,
): Promise<AliasRow[]> {
  const keys = [...new Set(extraction.lines.flatMap(exactAliasTexts))];
  if (keys.length === 0) {
    return [];
  }
  const { data, error } = await supabase.rpc(MATCH_EXACT_ALIASES_RPC, { p_supplier_id: supplierId, p_alias_keys: keys });
  throwIfSupabaseError(error);
  return (data ?? []) as AliasRow[];
}

const ALIAS_SELECT = "id, alias_norm, product_id, pack_label, units_per_pack, hits";

/**
 * Catálogo del proveedor. Vínculos (`supplier_products`) completos, paginados.
 * Alias (C6-M3, D33-c): NO todos los del proveedor (pueden ser miles), sino
 * los exactos de la factura (claves de `exactAliasTexts` por POST a
 * `invoice_match_exact_aliases`, D35) y los de los productos casados por SKU
 * del proveedor (`aliasForPack`, por ids). Los
 * difusos los da la RPC `invoice_match_candidates` (trigram, acotada por línea).
 */
async function loadCatalog(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  supplierId: string,
  extraction: InvoiceExtraction,
): Promise<MatchSupplierCatalog> {
  const aliasQuery = () =>
    supabase.from("supplier_product_aliases").select(ALIAS_SELECT).eq("store_id", storeId).eq("supplier_id", supplierId);
  const [linkRows, exactAliases] = await Promise.all([
    fetchAllPages<SupplierProductRow>((from, to) =>
      supabase
        .from("supplier_products")
        .select(SUPPLIER_PRODUCT_SELECT)
        .eq("store_id", storeId)
        .eq("supplier_id", supplierId)
        .eq("is_active", true)
        .eq("supplier_product_pack_units.is_active", true)
        .order("id")
        .range(from, to),
    ),
    loadExactAliases(supabase, supplierId, extraction),
  ]);

  const lineSkus = new Set(extraction.lines.map((line) => normalizeCode(line.supplierSku)).filter(Boolean));
  const skuProductIds = linkRows
    .filter((row) => lineSkus.has(normalizeCode(row.supplier_sku)))
    .map((row) => row.product_id);
  const skuAliases = await fetchAllIn<AliasRow>(skuProductIds, (chunk, from, to) =>
    aliasQuery().in("product_id", chunk).order("id").range(from, to),
  );
  const aliasById = new Map([...exactAliases, ...skuAliases].map((row) => [row.id, row]));

  const supplierProducts: MatchSupplierProduct[] = linkRows.map((row) => ({
    supplierProductId: row.id,
    productId: row.product_id,
    supplierSku: row.supplier_sku,
    isPreferred: row.is_preferred === true,
  }));
  const packUnits: MatchPackUnit[] = linkRows.flatMap((row) =>
    (row.supplier_product_pack_units ?? [])
      .filter((pack) => pack.is_active)
      .map((pack) => ({
        id: pack.id,
        productId: row.product_id,
        label: pack.label,
        unitsPerPack: Number(pack.units_per_pack),
        isDefault: pack.is_default === true,
      })),
  );
  const aliasRows: MatchAlias[] = [...aliasById.values()].map((row) => ({
    aliasNorm: row.alias_norm,
    productId: row.product_id,
    packLabel: row.pack_label,
    unitsPerPack: row.units_per_pack,
    hits: row.hits,
  }));

  return { supplierProducts, aliases: aliasRows, packUnits };
}

/**
 * Recetas activas de las que el producto es el empaque: `pack_product_id` ->
 * `total_units` (la conversión que `create_purchase` exige como `units_per_pack`).
 */
async function loadRecipeConversions(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  productIds: string[],
): Promise<Map<string, number | undefined>> {
  if (productIds.length === 0) {
    return new Map();
  }
  const rows = await fetchAllIn<{ pack_product_id: string; total_units: number | string | null }>(
    productIds,
    (chunk, from, to) =>
      supabase
        .from("product_pack_conversions")
        .select("pack_product_id, total_units")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .in("pack_product_id", chunk)
        .order("id")
        .range(from, to),
  );
  return new Map(rows.map((row) => [row.pack_product_id, toNumber(row.total_units)]));
}

/**
 * Tamaños de empaque de las recetas activas de las que el producto es
 * COMPONENTE (`product_pack_components.unit_product_id`), solo 1 a 1
 * (`units_per_pack = total_units`): es el `v_unit_pack_sizes` con el que
 * `create_purchase` valida una línea en modo empaque del producto (20261010d;
 * caos M-r4-1).
 */
async function loadComponentPackSizes(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  productIds: string[],
): Promise<Map<string, number[]>> {
  if (productIds.length === 0) {
    return new Map();
  }
  const rows = await fetchAllIn<{
    unit_product_id: string;
    units_per_pack: number | string;
    conversion: { total_units: number | string | null; is_active: boolean } | null;
  }>(productIds, (chunk, from, to) =>
    supabase
      .from("product_pack_components")
      .select("unit_product_id, units_per_pack, conversion:product_pack_conversions!inner(total_units, is_active)")
      .eq("store_id", storeId)
      .eq("conversion.is_active", true)
      .in("unit_product_id", chunk)
      .order("id")
      .range(from, to),
  );
  const sizes = new Map<string, number[]>();
  for (const row of rows) {
    const size = toNumber(row.units_per_pack);
    if (!row.conversion?.is_active || size === undefined || size !== toNumber(row.conversion.total_units)) {
      continue;
    }
    const list = sizes.get(row.unit_product_id) ?? [];
    if (!list.includes(size)) {
      list.push(size);
    }
    sizes.set(row.unit_product_id, list.sort((a, b) => a - b));
  }
  return sizes;
}

/** Última línea recibida por producto, del proveedor o de cualquiera (misma consulta que `purchaseLastCosts.server.ts`). */
async function loadLastLines(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  productIds: string[],
  supplierId?: string,
): Promise<Map<string, number>> {
  if (productIds.length === 0) {
    return new Map();
  }
  const rows = await fetchAllIn<LastLineRow>(productIds, (chunk, from, to) => {
    let query = supabase
      .from("products")
      .select(LAST_LINE_SELECT)
      .eq("store_id", storeId)
      .in("id", chunk)
      .eq("purchase_items.purchases.store_id", storeId)
      .eq("purchase_items.purchases.status", "recibido");
    if (supplierId) {
      query = query.eq("purchase_items.purchases.supplier_id", supplierId);
    }
    return query
      .order("purchases(created_at)", { ascending: false, referencedTable: "purchase_items" })
      .limit(1, { referencedTable: "purchase_items" })
      .order("id")
      .range(from, to);
  });

  const costs = new Map<string, number>();
  for (const row of rows) {
    const cost = toNumber(row.purchase_items?.[0]?.unit_cost_ref);
    if (cost !== undefined) {
      costs.set(row.id, cost);
    }
  }
  return costs;
}

/** D24-c: último costo recibido (del proveedor o de cualquiera) y, si no hay, el costo de referencia del producto. */
function lastReceivedCostRef(
  row: ProductRow,
  supplierCosts: Map<string, number>,
  anyCosts: Map<string, number>,
): number | null {
  return supplierCosts.get(row.id) ?? anyCosts.get(row.id) ?? positiveCost(row.current_cost_ref) ?? null;
}

function toSupplierCandidates(result: CandidatesRpcResult): MatchSupplierCandidate[] {
  return (result.suppliers ?? []).map((row) => ({
    contactId: row.contact_id,
    name: row.name,
    taxId: row.tax_id,
    score: toNumber(row.score) ?? 0,
  }));
}

/**
 * Segunda pasada difusa SOLO para las líneas sin ningún candidato: el empaque,
 * los prefijos y la unidad pegada al número ("JUSTY 400ML [BULTO X 15,00]")
 * dejan el trigram bajo 0,6 aunque el producto exista. Pide candidatos con los
 * textos de `searchTextVariants` al mismo proveedor elegido y se queda, por
 * línea, con el mejor score de cada producto. Lo que salga es dudosa.
 */
async function loadVariantFuzzy(
  supabase: MatchContextSupabaseClient,
  extraction: InvoiceExtraction,
  fuzzy: Record<number, MatchFuzzyCandidate[]>,
  supplierId: string | undefined,
): Promise<Record<number, MatchFuzzyCandidate[]>> {
  const owners: number[] = [];
  const texts: string[] = [];
  extraction.lines.forEach((line, index) => {
    if ((fuzzy[index]?.length ?? 0) > 0) {
      return;
    }
    for (const text of searchTextVariants(line)) {
      if (texts.length < MATCH_CANDIDATES_MAX_TEXTS) {
        owners.push(index);
        texts.push(text);
      }
    }
  });
  if (texts.length === 0) {
    return {};
  }

  const { data, error } = await supabase.rpc(MATCH_CANDIDATES_RPC, {
    p_supplier_name: normalizeAlias(extraction.supplier.name ?? ""),
    p_supplier_tax_id: extraction.supplier.taxId ?? null,
    p_texts: texts,
    p_descriptions: texts,
    ...(supplierId ? { p_supplier_id: supplierId } : {}),
    p_limit: MATCH_CANDIDATES_PER_LINE,
  });
  throwIfSupabaseError(error);

  const best = new Map<number, Map<string, MatchFuzzyCandidate>>();
  for (const [variantIndex, list] of Object.entries(toFuzzy((data ?? {}) as CandidatesRpcResult, texts.length))) {
    const line = owners[Number(variantIndex)];
    const byProduct = best.get(line) ?? new Map<string, MatchFuzzyCandidate>();
    for (const candidate of list) {
      const previous = byProduct.get(candidate.productId);
      if (!previous || candidate.score > previous.score) {
        byProduct.set(candidate.productId, candidate);
      }
    }
    best.set(line, byProduct);
  }
  const result: Record<number, MatchFuzzyCandidate[]> = {};
  for (const [line, byProduct] of best) {
    result[line] = [...byProduct.values()].sort((a, b) => b.score - a.score).slice(0, MATCH_CANDIDATES_PER_LINE);
  }
  return result;
}

function toFuzzy(result: CandidatesRpcResult, lineCount: number): Record<number, MatchFuzzyCandidate[]> {
  const fuzzy: Record<number, MatchFuzzyCandidate[]> = {};
  for (const row of result.lines ?? []) {
    const index = Number(row.ordinal) - 1;
    const score = toNumber(row.score);
    if (!Number.isInteger(index) || index < 0 || index >= lineCount || score === undefined) {
      continue;
    }
    if (row.via !== "alias" && row.via !== "name") {
      continue;
    }
    (fuzzy[index] ??= []).push({ productId: row.product_id, score, via: row.via });
  }
  return fuzzy;
}

/**
 * Contexto completo de `matchInvoice` para la tienda `storeId`.
 *
 * El proveedor "más probable" es el que eligió la RPC (RIF normalizado igual a
 * un único contacto o, si no, el de mejor score): de él salen los alias difusos,
 * su catálogo y `linkedToSupplier`. `matchInvoice` decide después si lo da por
 * resuelto (umbral 0,8 y margen 0,1) o solo lo propone.
 *
 * `options.excludeScanId`: pásalo con el id del escaneo que se está emparejando
 * cuando ese escaneo YA está guardado en `invoice_scans` (insertar y luego
 * emparejar, o re-emparejar en GET); si no, sale en `previousScans` y
 * `matchInvoice` lo marca como duplicado de sí mismo. Omítelo si el escaneo
 * aún no existe en la base.
 *
 * REP12-06: los escaneos previos se piden con el proveedor LEÍDO (`readDuplicateSupplier`) para
 * que el tope de candidatos no deje fuera el duplicado real; sin proveedor leído, como antes.
 */
export async function loadMatchContext(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  extraction: InvoiceExtraction,
  options?: { excludeScanId?: string },
): Promise<MatchContext> {
  const [candidates, taxRates, systemRate, barcodeProductIds] = await Promise.all([
    loadCandidates(supabase, extraction),
    loadTaxRates(supabase, storeId),
    loadSystemRate(),
    loadBarcodeProductIds(supabase, extraction),
  ]);

  const supplierCandidates = toSupplierCandidates(candidates);
  const supplierId = candidates.supplier_id ?? undefined;
  const firstFuzzy = toFuzzy(candidates, extraction.lines.length);
  const [catalog, variantFuzzy, previousScans] = await Promise.all([
    supplierId ? loadCatalog(supabase, storeId, supplierId, extraction) : Promise.resolve(undefined),
    loadVariantFuzzy(supabase, extraction, firstFuzzy, supplierId),
    loadPreviousScans(
      supabase,
      storeId,
      extraction,
      options?.excludeScanId,
      readDuplicateSupplier(extraction, supplierCandidates),
    ),
  ]);
  const fuzzy = { ...firstFuzzy, ...variantFuzzy };

  const referenced = new Set<string>([
    ...barcodeProductIds,
    ...Object.values(fuzzy).flatMap((list) => list.map((candidate) => candidate.productId)),
    ...(catalog?.supplierProducts.map((link) => link.productId) ?? []),
    ...(catalog?.aliases.map((alias) => alias.productId) ?? []),
  ]);
  const productIds = [...referenced];

  const [productRows, recipes, componentSizes, supplierCosts, anyCosts] = await Promise.all([
    loadProductsByIds(supabase, storeId, productIds),
    loadRecipeConversions(supabase, storeId, productIds),
    loadComponentPackSizes(supabase, storeId, productIds),
    supplierId ? loadLastLines(supabase, storeId, productIds, supplierId) : Promise.resolve(new Map<string, number>()),
    loadLastLines(supabase, storeId, productIds),
  ]);
  const loaded = new Map(productRows.map((row) => [row.id, row]));

  const linkedIds = new Set(catalog?.supplierProducts.map((link) => link.productId) ?? []);
  const products: MatchProduct[] = [...loaded.values()].map((row) => {
    const recipeUnitsPerPack = recipes.get(row.id);
    const componentPackSizes = componentSizes.get(row.id);
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      active: row.is_active,
      taxRateCode: row.category?.tax_rate?.code ?? null,
      lastUnitCostRef: lastReceivedCostRef(row, supplierCosts, anyCosts),
      linkedToSupplier: linkedIds.has(row.id),
      hasRecipe: recipes.has(row.id),
      ...(recipeUnitsPerPack !== undefined ? { recipeUnitsPerPack } : {}),
      ...(componentPackSizes ? { componentPackSizes } : {}),
    };
  });

  return {
    storeId,
    supplierCandidates,
    supplierCatalogs: supplierId ? { [supplierId]: catalog ?? EMPTY_CATALOG } : {},
    products,
    fuzzy,
    taxRates,
    systemRate,
    previousScans,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * D41-a: último costo por unidad de stock (REF) de unos productos elegidos en la revisión fuera
 * de los candidatos, con las mismas consultas y el mismo criterio que `loadMatchContext` +
 * `lastUnitCostRefOf` (D38): última línea recibida de `supplierId`, si no de cualquiera, si no
 * `current_cost_ref`; un producto con receta lo reparte entre las unidades de su conversión.
 * Uno por id pedido (sin repetidos), `null` si no se conoce o no es de la tienda. Solo ids en la URL.
 */
export async function loadLastUnitCostRefs(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  productIds: string[],
  supplierId?: string,
): Promise<InvoiceLastUnitCost[]> {
  const requested = [...new Set(productIds)];
  // `products.id` y `contacts.id` son uuid: otro texto no puede existir (y Postgres lo rechazaría).
  const ids = requested.filter((id) => UUID_PATTERN.test(id));
  const supplier = supplierId && UUID_PATTERN.test(supplierId) ? supplierId : undefined;

  if (ids.length === 0) {
    return requested.map((productId) => ({ productId, lastUnitCostRef: null }));
  }

  const [productRows, recipes, supplierCosts, anyCosts] = await Promise.all([
    loadProductsByIds(supabase, storeId, ids),
    loadRecipeConversions(supabase, storeId, ids),
    supplier ? loadLastLines(supabase, storeId, ids, supplier) : Promise.resolve(new Map<string, number>()),
    loadLastLines(supabase, storeId, ids),
  ]);
  const loaded = new Map(productRows.map((row) => [row.id, row]));

  return requested.map((productId) => {
    const row = loaded.get(productId);
    const cost = row
      ? lastUnitCostRefOf({
          lastUnitCostRef: lastReceivedCostRef(row, supplierCosts, anyCosts),
          hasRecipe: recipes.has(row.id),
          recipeUnitsPerPack: recipes.get(row.id),
        })
      : undefined;
    return { productId, lastUnitCostRef: cost ?? null };
  });
}
