/**
 * REP16-02 · D67(b): facturas del test de propiedad del panel de revisión.
 *
 * - `tasa3`: la del caos (`caos-global/p17/B/ex/p17-tasa3.json` y su respuesta de escaneo
 *   `ui/tlin2-1024x1366-d1100-scan-response.json`): Bs, SIN tasa impresa; L1 Harina a 4.500 Bs con último costo
 *   0,50 REF (al llegar la tasa del día, 900, queda desviada: M-p17B-1) y L2 Harina a 450.
 * - `estados`: una fila en cada estado (confirmada, dudosa con homónimos, sin emparejar con candidatos, sin producto,
 *   desviada al llegar la tasa, cerca del umbral, descartada, resuelta por el usuario y con importe que no cuadra) y
 *   aviso de duplicado del escaneo (su compra llega tarde). Sin tasa impresa o con 895 (`estadosImpresa`).
 */
import type { InvoiceDuplicateMatch, InvoiceExtraction, InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import type { ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import { makeReviewResponse, productUuid, type ReviewFixtureLine } from "../reviewFixtures";
import type { FixtureId } from "./InvoiceReviewPanel.rep16-02.cases";

const CAOS_SUPPLIER = "c0a05000-0000-4000-8000-000000000001";
const caosProduct = (suffix: string) => `c0a05000-0000-4000-8000-0000000000${suffix}`;

const tasa3Extraction: InvoiceExtraction = {
  confidence: 0.9,
  currency: "VES",
  date: "2026-10-17",
  lines: [
    {
      confidence: 0.95,
      description: "JABON AZUL 250G",
      lineTotal: 450,
      quantity: 1,
      rawText: "JABON AZUL 250G 1 450,00 450,00",
      taxHint: "exento",
      unit: "unidad",
      unitPrice: 450,
    },
    {
      confidence: 0.95,
      description: "CAOSG Harina Maiz 1kg",
      lineTotal: 4500,
      quantity: 1,
      rawText: "CAOSG Harina Maiz 1kg P3 1 4.500,00 4.500,00",
      taxHint: "exento",
      unit: "unidad",
      unitPrice: 4500,
    },
    {
      confidence: 0.95,
      description: "CAOSG Harina Maiz 1kg",
      lineTotal: 450,
      quantity: 1,
      rawText: "CAOSG Harina Maiz 1kg P3 1 450,00 450,00",
      taxHint: "exento",
      unit: "unidad",
      unitPrice: 450,
    },
  ],
  number: "CG17-TASA3",
  subtotal: 5400,
  supplier: { name: "Distribuidora Caos Global C.A.", taxId: "J-40999888-1" },
  total: 5400,
  warnings: [],
};

const harinaCandidate = {
  lastUnitCostRef: 0.5,
  name: "CAOSG Harina Maiz 1kg",
  productId: caosProduct("a3"),
  reason: "nombre parecido 1,00 · vinculado al proveedor",
  score: 1,
  sku: "CAOSG-003",
};

const tasa3: InvoiceScanResponse = {
  cached: false,
  extraction: tasa3Extraction,
  limits: { limit: 30, remaining: 29, used: 1 },
  matched: {
    lines: [
      {
        candidates: [
          { lastUnitCostRef: 0.5, name: "CAOSG Jabon Azul 250g", productId: caosProduct("a4"), reason: "nombre parecido 0,73", score: 0.7273, sku: "CAOSG-004" },
          { lastUnitCostRef: 0.5, name: "CAOSG Jabon Azul 250g", productId: caosProduct("a5"), reason: "nombre parecido 0,73", score: 0.7273, sku: "CAOSG-005" },
        ],
        entryMode: "unit",
        index: 0,
        issues: [],
        lastUnitCostRef: 0.5,
        status: "doubtful",
        taxRateCode: "exento",
        unitCostRef: 0.5,
        unitCostVes: 450,
      },
      {
        candidates: [harinaCandidate],
        entryMode: "unit",
        index: 1,
        issues: [],
        lastUnitCostRef: 0.5,
        status: "doubtful",
        taxRateCode: "exento",
        unitCostRef: 5,
        unitCostVes: 4500,
      },
      {
        candidates: [harinaCandidate],
        entryMode: "unit",
        index: 2,
        issues: [],
        lastUnitCostRef: 0.5,
        status: "doubtful",
        taxRateCode: "exento",
        unitCostRef: 0.5,
        unitCostVes: 450,
      },
    ],
    supplier: {
      candidates: [{ contactId: CAOS_SUPPLIER, name: "Distribuidora Caos Global C.A.", reason: "RIF igual", score: 1 }],
      contactId: CAOS_SUPPLIER,
    },
    totals: { computed: 5400, mismatch: false, read: 5400 },
  },
  scanId: "5a0e1b2c-3d4e-4f5a-8b6c-17a5a3000003",
};

/** Línea en Bs con su candidato (último costo 0,50 REF). */
function priced(seed: number, description: string, unitPrice: number, match: ReviewFixtureLine["match"] = {}): ReviewFixtureLine {
  const candidate = { lastUnitCostRef: 0.5, name: description, productId: productUuid(seed), reason: "nombre parecido 0,80", score: 0.8, sku: `R16-${seed}` };
  return {
    match: { candidates: [candidate], entryMode: "unit", issues: [], lastUnitCostRef: 0.5, productId: undefined, status: "doubtful", taxRateCode: "exento", ...match },
    read: { description, lineTotal: unitPrice, quantity: 1, rawText: `${description.toUpperCase()} 1 ${unitPrice},00`, taxHint: "exento", unit: "unidad", unitPrice },
  };
}

/** Índices de `estados` (los usa el arnés para las acciones previas a la referencia). */
export const ESTADOS_ROWS = { discarded: 6, resolvedByUser: 7, search: 3 } as const;

const estadosLines: ReviewFixtureLine[] = [
  // 0 · confirmada por el emparejamiento.
  priced(1, "Aceite Vatel 1L", 450, { productId: productUuid(1), status: "confirmed" }),
  // 1 · dudosa con dos homónimos (pendiente).
  {
    ...priced(2, "Jabon Azul 250g", 450),
    match: {
      ...priced(2, "Jabon Azul 250g", 450).match,
      candidates: [
        { lastUnitCostRef: 0.5, name: "Jabon Azul 250g", productId: productUuid(2), reason: "nombre parecido 0,73", score: 0.73, sku: "R16-004" },
        { lastUnitCostRef: 0.5, name: "Jabon Azul 250g", productId: productUuid(102), reason: "nombre parecido 0,73", score: 0.73, sku: "R16-005" },
      ],
    },
  },
  // 2 · sin emparejar con un candidato difuso.
  priced(3, "Pasta Primor 500g", 450, { candidates: [{ name: "Pasta Primor 1kg", productId: productUuid(3), reason: "nombre parecido 0,41", score: 0.41 }], lastUnitCostRef: undefined, status: "unmatched" }),
  // 3 · sin producto ni candidatos (la del buscador).
  priced(4, "Arroz Mary 1kg", 450, { candidates: undefined, lastUnitCostRef: undefined, status: "unmatched" }),
  // 4 · desviada en cuanto hay tasa (4.500 Bs frente a 0,50 REF), como L1 de M-p17B-1.
  priced(5, "Harina Maiz 1kg", 4500),
  // 5 · cerca del umbral: a 895 se desvía (+43 %), a 900/1000 no (o al revés según la tasa).
  priced(6, "Azucar Montalban 1kg", 640),
  // 6 · la descarta el usuario antes de la referencia.
  priced(7, "Sal Diana 1kg", 450),
  // 7 · la resuelve el usuario (toca su candidato) antes de la referencia.
  priced(8, "Cafe Fama 250g", 450),
  // 8 · el importe no cuadra con cantidad × precio («La factura dice …»).
  {
    ...priced(9, "Leche Completa 1L", 450),
    read: { ...priced(9, "Leche Completa 1L", 450).read, lineTotal: 1000, quantity: 2, rawText: "LECHE COMPLETA 1L 2 450,00 1.000,00" },
  },
];

const ESTADOS_TOTAL = 450 * 6 + 4500 + 640 + 1000;

function estados(printedRate: number | undefined): InvoiceScanResponse {
  return makeReviewResponse({
    extraction: {
      date: "2026-10-17",
      number: "R16-0002",
      printedRate,
      supplier: { name: "Distribuidora Reparación Dieciséis C.A.", taxId: "J-16020002-6" },
      total: ESTADOS_TOTAL,
    },
    lines: estadosLines,
    matched: { duplicateOfScanId: "6b1f2c3d-4e5f-4a6b-8c7d-160200000d01" },
  });
}

export type Fixture = {
  id: FixtureId;
  response: InvoiceScanResponse;
  /** Tasa del día que llega tarde. */
  systemRateVes: number;
  supplierName: string;
};

export const FIXTURES: Record<FixtureId, Fixture> = {
  estados: { id: "estados", response: estados(undefined), supplierName: "Distribuidora Reparación Dieciséis C.A.", systemRateVes: 900 },
  estadosImpresa: { id: "estadosImpresa", response: estados(895), supplierName: "Distribuidora Reparación Dieciséis C.A.", systemRateVes: 1000 },
  tasa3: { id: "tasa3", response: tasa3, supplierName: "Distribuidora Caos Global C.A.", systemRateVes: 900 },
};

export const DUPLICATE_MATCH: InvoiceDuplicateMatch = {
  date: "2026-10-17",
  number: "R16-0002",
  purchaseId: "7c2a3b4d-5e6f-4a7b-8c9d-16020000c0a1",
  scanId: "5a0e1b2c-3d4e-4f5a-9b6c-160200000d02",
};

/** Lo que devuelve el buscador de productos para la fila sin producto. */
export const SEARCH_PRODUCTS: ProductEntityOption[] = [
  {
    barcode: null,
    categoryId: "cat-1",
    currentCostRef: 0.5,
    currentStock: 4,
    id: productUuid(600),
    isActive: true,
    label: "Arroz Mary 1kg",
    salePriceRef: 1,
    sku: "R16-ARROZ",
  },
];

/** Último costo (REF) de «Arroz Mary 1kg» según el resultado del caso (a 900 Bs la línea cuesta 0,50 REF). */
export const LAST_COST_REF = { aligned: 0.5, deviated: 0.05 } as const;
