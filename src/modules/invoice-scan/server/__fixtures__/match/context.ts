import type { InvoiceExtraction, InvoiceExtractionLine } from "../../../contracts";
import type { MatchContext, MatchProduct } from "../../match.types";

/**
 * Catálogo de prueba. Tasa del sistema 100 Bs/REF para que las cuentas se
 * lean a simple vista (1.000 Bs = 10 REF).
 */
export const SUPPLIER_POLAR = "sup-polar";
export const SUPPLIER_CHEVERE = "sup-chevere";
export const SUPPLIER_PEPSI = "sup-pepsi";

export const products: MatchProduct[] = [
  {
    id: "p-malta",
    name: "Malta Polar 355 ml",
    sku: "MAL-001",
    barcode: "7591001000011",
    active: true,
    taxRateCode: "general",
    lastUnitCostRef: 0.5,
    hasRecipe: false,
  },
  {
    id: "p-harina",
    name: "Harina PAN 1 kg",
    sku: "HAR-001",
    barcode: "7591002000028",
    active: true,
    taxRateCode: "exento",
    lastUnitCostRef: 1.2,
    hasRecipe: false,
  },
  {
    id: "p-refresco",
    name: "Refresco Cola 2 L",
    sku: "REF-001",
    barcode: null,
    active: true,
    taxRateCode: "general",
    lastUnitCostRef: 3,
    hasRecipe: false,
  },
  {
    id: "p-aceite",
    name: "Aceite Vatel 1 L",
    sku: "ACE-001",
    barcode: null,
    active: true,
    taxRateCode: "reducida",
    lastUnitCostRef: 2.5,
    hasRecipe: false,
  },
  {
    id: "p-caja-malta",
    name: "Caja Malta Polar x36",
    sku: "CMA-036",
    barcode: null,
    active: true,
    taxRateCode: "general",
    lastUnitCostRef: 18,
    hasRecipe: true,
    recipeUnitsPerPack: 36,
  },
  {
    id: "p-arroz-a",
    name: "Arroz Mary 1 kg",
    sku: "ARR-001",
    barcode: null,
    active: true,
    taxRateCode: "exento",
    lastUnitCostRef: 1,
    hasRecipe: false,
  },
  {
    id: "p-arroz-b",
    name: "Arroz Mary 1 kg",
    sku: "ARR-002",
    barcode: null,
    active: true,
    taxRateCode: "general",
    lastUnitCostRef: 1,
    hasRecipe: false,
  },
  {
    id: "p-galleta",
    name: "Galleta María",
    sku: "GAL-001",
    barcode: null,
    active: false,
    taxRateCode: "general",
    lastUnitCostRef: null,
    hasRecipe: false,
  },
  {
    id: "p-pepsi",
    name: "Pepsi 2 L",
    sku: "PEP-001",
    barcode: null,
    active: true,
    taxRateCode: null,
    lastUnitCostRef: null,
    hasRecipe: false,
  },
];

export function buildContext(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    storeId: "store-1",
    supplierCandidates: [
      { contactId: SUPPLIER_POLAR, name: "Distribuidora Polar C.A.", taxId: "J-00041312-3" },
      { contactId: SUPPLIER_CHEVERE, name: "Chevere Depot", taxId: "J-40123456-7" },
      { contactId: SUPPLIER_PEPSI, name: "Pepsi-Cola Venezuela", taxId: null },
    ],
    supplierCatalogs: {
      [SUPPLIER_POLAR]: {
        supplierProducts: [
          { supplierProductId: "sp-malta", productId: "p-malta", supplierSku: "MAL-355", isPreferred: true },
          { supplierProductId: "sp-harina", productId: "p-harina", supplierSku: null },
          { supplierProductId: "sp-refresco", productId: "p-refresco", supplierSku: "REF 2L" },
          { supplierProductId: "sp-aceite", productId: "p-aceite", supplierSku: "ACE-1" },
          { supplierProductId: "sp-caja-malta", productId: "p-caja-malta", supplierSku: "CMX36" },
          { supplierProductId: "sp-arroz-b", productId: "p-arroz-b", supplierSku: null },
        ],
        aliases: [
          { aliasNorm: "malta polar 355 ml", productId: "p-malta", packLabel: null, unitsPerPack: null, hits: 4 },
          { aliasNorm: "harina pan 1kg bulto", productId: "p-harina", packLabel: "BULTO", unitsPerPack: 20, hits: 2 },
          { aliasNorm: "harina pan 1kg", productId: "p-harina", packLabel: null, unitsPerPack: null, hits: 1 },
        ],
        packUnits: [
          { id: "pu-malta-6", productId: "p-malta", label: "Caja x6", unitsPerPack: 6, isDefault: true },
          { id: "pu-refresco-6", productId: "p-refresco", label: "Paquete x6", unitsPerPack: 6 },
          { id: "pu-aceite-12", productId: "p-aceite", label: "Caja x12", unitsPerPack: 12 },
          { id: "pu-aceite-24", productId: "p-aceite", label: "Caja x24", unitsPerPack: 24 },
        ],
      },
    },
    products,
    fuzzy: {},
    taxRates: [
      { code: "exento", pct: 0, kind: "exento" },
      { code: "reducida", pct: 8, kind: "reducida" },
      { code: "general", pct: 16, kind: "general", isDefault: true },
    ],
    systemRate: 100,
    previousScans: [],
    ...overrides,
  };
}

export function buildLine(overrides: Partial<InvoiceExtractionLine> = {}): InvoiceExtractionLine {
  const description = overrides.description ?? "MALTA POLAR 355 ML";
  return {
    rawText: overrides.rawText ?? description,
    description,
    quantity: 12,
    unitPrice: 50,
    lineTotal: 600,
    confidence: 0.95,
    ...overrides,
  };
}

/** Factura de Polar por RIF, en Bs, una línea por defecto. */
export function buildExtraction(overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    supplier: { name: "DISTRIBUIDORA POLAR, C.A.", taxId: "J000413123" },
    number: "00012345",
    date: "2026-10-14",
    currency: "VES",
    lines: [buildLine()],
    confidence: 0.9,
    warnings: [],
    ...overrides,
  };
}
