/**
 * Contexto de emparejamiento de una factura escaneada (SCN-05a).
 *
 * `matchInvoice(extraction, ctx)` es PURA: todo lo que necesita saber de la
 * base viene aquí. Lo arma `loadMatchContext(supabase, storeId, extraction)`
 * (SCN-05b) y lo reutiliza el banco de evaluación con fixtures. Los nombres
 * siguen las columnas reales (en camelCase) para que el loader sea un mapeo
 * directo:
 *
 * - `contacts` (proveedor / ambos): `id`, `name`, `tax_id`.
 * - `supplier_products`: `id`, `supplier_id`, `product_id`, `supplier_sku`,
 *   `is_active`, `is_preferred` (20261009e).
 * - `supplier_product_aliases` (20261019b): `alias_norm`, `product_id`,
 *   `pack_label`, `units_per_pack`, `hits`.
 * - `supplier_product_pack_units`: `id`, `supplier_product_id`, `label`,
 *   `units_per_pack`, `is_default`, `is_active`.
 * - `products`: `id`, `name`, `sku`, `barcode`, `is_active`; la alícuota sale de
 *   `categories.tax_rate_id -> tax_rates.code` (20261007a; el producto no tiene
 *   alícuota propia); la receta de `product_pack_conversions` /
 *   `product_pack_recipe` (20260811, 20261009d, 20261011c).
 * - Último costo: la última línea recibida (`purchase_items.unit_cost_ref`),
 *   como `purchaseLastCosts.server.ts`.
 * - `tax_rates_for_store` (20261007a): `code`, `pct`, `is_active`, y
 *   `app_settings.default_tax_rate_id` para la por defecto.
 * - Tasa del día: `exchange_rates.rate_ves` vigente (`useCurrentExchangeRate`
 *   en purchase-create, `rateVes`: Bs por 1 REF).
 * - `invoice_scans` (20261019a): escaneos previos de la tienda para duplicados.
 */

/** Contacto proveedor (o "ambos") candidato a ser el emisor de la factura. */
export type MatchSupplierCandidate = {
  /** `contacts.id`. */
  contactId: string;
  /** `contacts.name`. */
  name: string;
  /** `contacts.tax_id` (RIF) tal como está guardado; se normaliza al comparar. */
  taxId?: string | null;
  /**
   * Similitud 0..1 del nombre ya calculada por la base (p. ej. `similarity()` de
   * pg_trgm contra `extraction.supplier.name`). Opcional: si falta, la parte pura
   * calcula una similitud de bigramas sobre el nombre normalizado.
   */
  score?: number;
};

/** Vínculo proveedor-producto (`supplier_products`). */
export type MatchSupplierProduct = {
  /** `supplier_products.id`. */
  supplierProductId: string;
  /** `supplier_products.product_id`. */
  productId: string;
  /** `supplier_products.supplier_sku`: código del producto en el catálogo del proveedor. */
  supplierSku: string | null;
  /** `supplier_products.is_preferred` (proveedor habitual del producto, 20261009e). */
  isPreferred?: boolean;
};

/** Alias aprendido de una línea de factura (`supplier_product_aliases`). */
export type MatchAlias = {
  /** `alias_norm`: texto ya normalizado con `normalizeAlias`. */
  aliasNorm: string;
  /** `product_id`. */
  productId: string;
  /** `pack_label` con el que se confirmó ("CAJA", "BULTO"), si se confirmó en empaque. */
  packLabel: string | null;
  /** `units_per_pack` confirmado; resuelve el tamaño del empaque la siguiente vez. */
  unitsPerPack: number | null;
  /** `hits`: veces que el alias se confirmó con este producto. */
  hits: number;
};

/** Empaque del proveedor (`supplier_product_pack_units`, solo activos). */
export type MatchPackUnit = {
  /** `supplier_product_pack_units.id` (es el `packUnitId` de la línea). */
  id: string;
  /** `product_id` del `supplier_products` dueño (`supplier_product_id`). */
  productId: string;
  /** `label` ("Caja x12"). */
  label: string;
  /** `units_per_pack`. */
  unitsPerPack: number;
  /** `is_default`. */
  isDefault?: boolean;
};

/** Catálogo de un proveedor: solo filas activas del proveedor y de la tienda. */
export type MatchSupplierCatalog = {
  supplierProducts: MatchSupplierProduct[];
  aliases: MatchAlias[];
  packUnits: MatchPackUnit[];
};

/** Producto que puede aparecer en el emparejamiento (por SKU, alias, barcode o fuzzy). */
export type MatchProduct = {
  /** `products.id`. */
  id: string;
  /** `products.name`. */
  name: string;
  /** `products.sku`. */
  sku: string | null;
  /** `products.barcode`. */
  barcode: string | null;
  /** `products.is_active`. Los inactivos no entran como candidatos por nombre. */
  active: boolean;
  /** `tax_rates.code` de la categoría del producto (`categories.tax_rate_id`); null sin categoría o sin alícuota. */
  taxRateCode: string | null;
  /** Último costo unitario conocido en REF (última línea recibida); base de la coherencia de precio. */
  lastUnitCostRef?: number | null;
  /**
   * Tiene vínculo activo en `supplier_products` con el proveedor que resolvió
   * la base. También cuenta como vinculado si aparece en
   * `supplierCatalogs[contactId].supplierProducts` del proveedor resuelto aquí.
   */
  linkedToSupplier?: boolean;
  /** Es un empaque con receta activa (`product_pack_conversions` / receta por componentes). */
  hasRecipe: boolean;
  /**
   * `product_pack_conversions.total_units` de la receta ACTIVA de la que el
   * producto es el empaque (`pack_product_id`; una sola por el índice único de
   * 20260811): unidades que salen de un empaque. `create_purchase` exige que una
   * línea en modo empaque de este producto mande exactamente este
   * `units_per_pack` (20261009d / 20261010d). Sin receta, `undefined`.
   */
  recipeUnitsPerPack?: number;
  /**
   * Tamaños de empaque en los que el producto es COMPONENTE (unidad) de una
   * receta activa de otro producto: `product_pack_components.units_per_pack`
   * de las conversiones activas donde es `unit_product_id` y
   * `units_per_pack = product_pack_conversions.total_units` (1 a 1). Si hay
   * alguno, `create_purchase` solo acepta una línea en modo empaque de este
   * producto con uno de estos `units_per_pack` (20261010d, `v_unit_pack_sizes`;
   * caos M-r4-1). Sin recetas de las que sea componente, `undefined`.
   */
  componentPackSizes?: number[];
};

/** Cómo llegó un candidato difuso. */
export type MatchFuzzyVia = "alias" | "name";

/** Candidato difuso YA puntuado por la base (trigramas): la parte pura no los calcula. */
export type MatchFuzzyCandidate = {
  productId: string;
  /** 0..1. Los de `via: 'alias'` solo cuentan desde `FUZZY_ALIAS_MIN_SCORE` (0,6). */
  score: number;
  via: MatchFuzzyVia;
};

/** Tipo de alícuota para leer el `taxHint` de la factura. */
export type MatchTaxRateKind = "exento" | "reducida" | "general" | "otra";

/** Alícuota ACTIVA para la tienda (`tax_rates_for_store`, `is_active = true`). */
export type MatchTaxRate = {
  /** `tax_rates.code` (lo que guarda `purchase_items.tax_rate_code`). */
  code: string;
  /** `tax_rates.pct`. */
  pct: number;
  /** Clasificación para casar el `taxHint` (exento = 0 %, reducida, general). */
  kind: MatchTaxRateKind;
  /** Es `app_settings.default_tax_rate_id` de la tienda. */
  isDefault?: boolean;
};

/** Escaneo anterior de la tienda (para avisar duplicado). */
export type MatchPreviousScan = {
  /** `invoice_scans.id`. */
  scanId: string;
  /** `invoice_scans.supplier_id` (el elegido al confirmar) o, sin él, el contacto leído. */
  supplierId?: string | null;
  /**
   * REP12-01 (D53): contacto leído en ese escaneo (`matched->supplier->contactId`), aunque se
   * confirmara eligiendo otro proveedor: también cuenta como el mismo proveedor.
   */
  matchedContactId?: string | null;
  /** RIF leído en ese escaneo (`extracted->supplier->taxId`). */
  supplierTaxId?: string | null;
  /**
   * REP12-01 (D53): RIF guardado (`contacts.tax_id` de la tienda) de `supplierId` y de
   * `matchedContactId`; se cruza con el RIF leído y con el de los contactos del actual.
   */
  contactTaxIds?: string[];
  /** Número de factura leído en ese escaneo (`extracted->number`). */
  number: string | null;
  /** Fecha leída en ese escaneo (`extracted->date`, ISO), para el posible duplicado. */
  date?: string | null;
  /** Total leído en ese escaneo (`extracted->total`), para el posible duplicado. */
  total?: number | null;
  /** Compra con la que se confirmó (`purchase_id`): el aviso prefiere estos (SCN-UI-C2). */
  purchaseId?: string | null;
  /** Estado de esa compra (`purchases.status`): con `cancelado` no es duplicado (REP3-03a). */
  purchaseStatus?: string | null;
};

export type MatchContext = {
  /** Tienda del servidor (nunca del cliente). Solo trazabilidad: el ctx ya viene filtrado por ella. */
  storeId: string;
  /** Contactos proveedor/ambos candidatos (por RIF y/o nombre). */
  supplierCandidates: MatchSupplierCandidate[];
  /**
   * Catálogo por `contactId`. El loader carga al menos el del candidato más
   * probable; si el proveedor resuelto no tiene entrada, se trata como vacío
   * (sin pasos 1 y 2 de la cascada).
   */
  supplierCatalogs: Record<string, MatchSupplierCatalog>;
  /** Productos relevantes: los de los catálogos, los de barcode y los de los candidatos difusos. */
  products: MatchProduct[];
  /** Candidatos difusos por índice de línea (`extraction.lines[i]`). */
  fuzzy: Record<number, MatchFuzzyCandidate[]>;
  /** Alícuotas activas de la tienda. */
  taxRates: MatchTaxRate[];
  /** Tasa del día del sistema: Bs por 1 REF (`exchange_rates.rate_ves`). Sin ella, `undefined`. */
  systemRate?: number;
  /** Escaneos anteriores de la tienda (para `duplicateOfScanId`). */
  previousScans: MatchPreviousScan[];
};

/**
 * D41-a: último costo por unidad de stock (REF) de un producto elegido en la revisión fuera de
 * los candidatos (`GET /api/purchases/invoice-scan/last-unit-costs`); misma semántica que
 * `InvoiceLineMatch.lastUnitCostRef` (D38). `null` si no se conoce.
 */
export type InvoiceLastUnitCost = {
  productId: string;
  lastUnitCostRef: number | null;
};
