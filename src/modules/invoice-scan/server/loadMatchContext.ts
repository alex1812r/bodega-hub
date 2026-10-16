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
 *    (`getCurrentExchangeRate`, la del formulario de compra), escaneos previos con el mismo número y productos por código de barras.
 * 2. Catálogo del proveedor elegido por la RPC: `supplier_products` activos con
 *    sus `supplier_product_pack_units` activos y `supplier_product_aliases`; en
 *    paralelo, la misma RPC con textos limpios (`searchTextVariants`) para las
 *    líneas que no trajeron ningún candidato difuso.
 * 3. Detalle de los productos referenciados (candidatos + catálogo + alias +
 *    barcode): alícuota de la categoría, receta activa, tamaños de las recetas
 *    de las que es componente y último costo recibido.
 */
import { normalizeAlias } from "@bodega/core/invoice";
import { invoiceAliasKey } from "../invoiceAliasKey";

import { throwIfSupabaseError } from "@/lib/supabase/errors";
import type { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { getCurrentExchangeRate } from "@/modules/settings/services/exchangeRates.server";

import type { InvoiceExtraction } from "../contracts";

import type {
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
import { searchTextVariants } from "./match/searchText";
import { normalizeInvoiceNumber } from "./match/text";

/** Mismo cliente que usan los `*.server.ts` (sesión del usuario: `auth.uid()` para la RPC). */
export type MatchContextSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

/** Nombre de la RPC de candidatos (20261019d). */
export const MATCH_CANDIDATES_RPC = "invoice_match_candidates";
/** Candidatos difusos por línea pedidos a la RPC (la RPC acota a 5). */
export const MATCH_CANDIDATES_PER_LINE = 5;
/** Textos máximos por llamada a la RPC (por encima responde PT400). */
export const MATCH_CANDIDATES_MAX_TEXTS = 500;
/** Escaneos previos con el mismo número normalizado que se pasan a `matchInvoice`. */
export const PREVIOUS_SCANS_LIMIT = 50;
/** Candidatos que se piden a la base antes de filtrar por número normalizado. */
export const PREVIOUS_SCAN_CANDIDATES_LIMIT = 200;

const PRODUCT_SELECT = "id, name, sku, barcode, is_active, category:categories(tax_rate:tax_rates(code))";
/** Igual que `purchaseLastCosts.server.ts`: la última línea recibida de cada producto. */
const LAST_LINE_SELECT = "id, purchase_items(unit_cost_ref, purchases!inner(created_at))";
const SUPPLIER_PRODUCT_SELECT =
  "id, product_id, supplier_sku, is_preferred, supplier_product_pack_units(id, label, units_per_pack, is_default, is_active)";
const PREVIOUS_SCAN_SELECT =
  "id, supplier_id, number:extracted->>number, supplier_tax_id:extracted->supplier->>taxId, matched_contact_id:matched->supplier->>contactId, date:extracted->>date, total:extracted->>total, purchase_id";

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

type PreviousScanRow = {
  id: string;
  supplier_id: string | null;
  number: string | null;
  supplier_tax_id: string | null;
  matched_contact_id: string | null;
  date?: string | null;
  total?: number | string | null;
  purchase_id?: string | null;
};

const EMPTY_CATALOG: MatchSupplierCatalog = { supplierProducts: [], aliases: [], packUnits: [] };

function toNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
 * Si DolarAPI falla, el formulario se queda sin tasa del día (la ruta responde
 * error, no cae a la última guardada); aquí igual: `undefined`, y `matchInvoice`
 * aplica 6.7 (tasa impresa con aviso o, sin ella, sin costos REF y con aviso).
 */
async function loadSystemRate(storeId: string): Promise<number | undefined> {
  try {
    const { rateVes } = await getCurrentExchangeRate(storeId);
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
 * (`loadPreviousScansByDateTotal`), con fecha y total leídos.
 */
async function loadPreviousScans(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  extraction: InvoiceExtraction,
  excludeScanId?: string,
): Promise<MatchPreviousScan[]> {
  const [byNumber, byDateTotal] = await Promise.all([
    loadPreviousScansByNumber(supabase, storeId, extraction, excludeScanId),
    loadPreviousScansByDateTotal(supabase, storeId, extraction, excludeScanId),
  ]);
  const seen = new Set(byNumber.map((row) => row.id));
  return [...byNumber, ...byDateTotal.filter((row) => !seen.has(row.id))].map((row) => ({
    scanId: row.id,
    supplierId: row.supplier_id ?? row.matched_contact_id ?? null,
    supplierTaxId: row.supplier_tax_id ?? null,
    number: row.number ?? null,
    date: row.date ?? undefined,
    total: toNumber(row.total),
    purchaseId: row.purchase_id ?? undefined,
  }));
}

/**
 * Posible duplicado (caos 5.4, `findDuplicateScan`): escaneos con el mismo
 * total leído (±0,01) y, si se leyó, la misma fecha. Solo hace falta si el
 * número falta o puede estar mal leído; con número y sin fecha no aplica.
 * `extracted->>total` es el texto del número JSON (lo que da `String(n)` en
 * JS), así que se piden las tres variantes al céntimo. El proveedor lo decide
 * `findDuplicateScan`.
 */
async function loadPreviousScansByDateTotal(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  extraction: InvoiceExtraction,
  excludeScanId?: string,
): Promise<PreviousScanRow[]> {
  const total = extraction.total;
  const date = extraction.date?.trim();
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    return [];
  }
  if (!date && normalizeInvoiceNumber(extraction.number)) {
    return [];
  }

  const cents = Math.round(total * 100);
  const totals = [cents - 1, cents, cents + 1].map((value) => String(value / 100));
  let query = supabase
    .from("invoice_scans")
    .select(PREVIOUS_SCAN_SELECT)
    .eq("store_id", storeId)
    .not("status", "in", "(discarded,failed)")
    .in("extracted->>total", totals);
  if (date) {
    query = query.eq("extracted->>date", date);
  }
  if (excludeScanId) {
    query = query.neq("id", excludeScanId);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(PREVIOUS_SCANS_LIMIT);
  throwIfSupabaseError(error);
  return (data ?? []) as unknown as PreviousScanRow[];
}

async function loadPreviousScansByNumber(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  extraction: InvoiceExtraction,
  excludeScanId?: string,
): Promise<PreviousScanRow[]> {
  const number = normalizeInvoiceNumber(extraction.number);
  if (!number) {
    return [];
  }

  let query = supabase
    .from("invoice_scans")
    .select(PREVIOUS_SCAN_SELECT)
    .eq("store_id", storeId)
    .not("status", "in", "(discarded,failed)")
    // `number` solo tiene [A-Z0-9]: no hay comodines de LIKE que escapar.
    .ilike("extracted->>number", `%${[...number].join("%")}`);
  if (excludeScanId) {
    query = query.neq("id", excludeScanId);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(PREVIOUS_SCAN_CANDIDATES_LIMIT);
  throwIfSupabaseError(error);

  return ((data ?? []) as unknown as PreviousScanRow[])
    .filter((row) => normalizeInvoiceNumber(row.number) === number)
    .slice(0, PREVIOUS_SCANS_LIMIT);
}

async function loadProductsWhere(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  column: "id" | "barcode",
  values: string[],
): Promise<ProductRow[]> {
  if (values.length === 0) {
    return [];
  }
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("store_id", storeId)
    .in(column, values);
  throwIfSupabaseError(error);
  return (data ?? []) as unknown as ProductRow[];
}

async function loadCatalog(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  supplierId: string,
): Promise<MatchSupplierCatalog> {
  const [links, aliases] = await Promise.all([
    supabase
      .from("supplier_products")
      .select(SUPPLIER_PRODUCT_SELECT)
      .eq("store_id", storeId)
      .eq("supplier_id", supplierId)
      .eq("is_active", true)
      .eq("supplier_product_pack_units.is_active", true),
    supabase
      .from("supplier_product_aliases")
      .select("alias_norm, product_id, pack_label, units_per_pack, hits")
      .eq("store_id", storeId)
      .eq("supplier_id", supplierId),
  ]);
  throwIfSupabaseError(links.error);
  throwIfSupabaseError(aliases.error);

  const linkRows = (links.data ?? []) as unknown as SupplierProductRow[];
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
  const aliasRows: MatchAlias[] = ((aliases.data ?? []) as AliasRow[]).map((row) => ({
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
  const { data, error } = await supabase
    .from("product_pack_conversions")
    .select("pack_product_id, total_units")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .in("pack_product_id", productIds);
  throwIfSupabaseError(error);
  const rows = (data ?? []) as Array<{ pack_product_id: string; total_units: number | string | null }>;
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
  const { data, error } = await supabase
    .from("product_pack_components")
    .select("unit_product_id, units_per_pack, conversion:product_pack_conversions!inner(total_units, is_active)")
    .eq("store_id", storeId)
    .eq("conversion.is_active", true)
    .in("unit_product_id", productIds);
  throwIfSupabaseError(error);
  const rows = (data ?? []) as unknown as Array<{
    unit_product_id: string;
    units_per_pack: number | string;
    conversion: { total_units: number | string | null; is_active: boolean } | null;
  }>;
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
  let query = supabase
    .from("products")
    .select(LAST_LINE_SELECT)
    .eq("store_id", storeId)
    .in("id", productIds)
    .eq("purchase_items.purchases.store_id", storeId)
    .eq("purchase_items.purchases.status", "recibido");
  if (supplierId) {
    query = query.eq("purchase_items.purchases.supplier_id", supplierId);
  }
  const { data, error } = await query
    .order("purchases(created_at)", { ascending: false, referencedTable: "purchase_items" })
    .limit(1, { referencedTable: "purchase_items" });
  throwIfSupabaseError(error);

  const costs = new Map<string, number>();
  for (const row of (data ?? []) as unknown as LastLineRow[]) {
    const cost = toNumber(row.purchase_items?.[0]?.unit_cost_ref);
    if (cost !== undefined) {
      costs.set(row.id, cost);
    }
  }
  return costs;
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
 */
export async function loadMatchContext(
  supabase: MatchContextSupabaseClient,
  storeId: string,
  extraction: InvoiceExtraction,
  options?: { excludeScanId?: string },
): Promise<MatchContext> {
  const [candidates, taxRates, systemRate, previousScans, barcodeRows] = await Promise.all([
    loadCandidates(supabase, extraction),
    loadTaxRates(supabase, storeId),
    loadSystemRate(storeId),
    loadPreviousScans(supabase, storeId, extraction, options?.excludeScanId),
    loadProductsWhere(supabase, storeId, "barcode", barcodeVariants(extraction)),
  ]);

  const supplierCandidates = toSupplierCandidates(candidates);
  const supplierId = candidates.supplier_id ?? undefined;
  const firstFuzzy = toFuzzy(candidates, extraction.lines.length);
  const [catalog, variantFuzzy] = await Promise.all([
    supplierId ? loadCatalog(supabase, storeId, supplierId) : Promise.resolve(undefined),
    loadVariantFuzzy(supabase, extraction, firstFuzzy, supplierId),
  ]);
  const fuzzy = { ...firstFuzzy, ...variantFuzzy };

  const loaded = new Map(barcodeRows.map((row) => [row.id, row]));
  const referenced = new Set<string>([
    ...loaded.keys(),
    ...Object.values(fuzzy).flatMap((list) => list.map((candidate) => candidate.productId)),
    ...(catalog?.supplierProducts.map((link) => link.productId) ?? []),
    ...(catalog?.aliases.map((alias) => alias.productId) ?? []),
  ]);
  const productIds = [...referenced];
  const missing = productIds.filter((id) => !loaded.has(id));

  const [extraRows, recipes, componentSizes, supplierCosts, anyCosts] = await Promise.all([
    loadProductsWhere(supabase, storeId, "id", missing),
    loadRecipeConversions(supabase, storeId, productIds),
    loadComponentPackSizes(supabase, storeId, productIds),
    supplierId ? loadLastLines(supabase, storeId, productIds, supplierId) : Promise.resolve(new Map<string, number>()),
    loadLastLines(supabase, storeId, productIds),
  ]);
  for (const row of extraRows) {
    loaded.set(row.id, row);
  }

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
      lastUnitCostRef: supplierCosts.get(row.id) ?? anyCosts.get(row.id) ?? null,
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
