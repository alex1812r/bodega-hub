import { z } from "zod";

import { formatVesBs, roundMoney } from "@/shared/utils/currency";

import type { PurchaseLinesSnapshot } from "../hooks/usePurchaseLines";
import type { PurchaseProductResolutions } from "../services/resolvePurchaseProducts";
import type { PurchaseCostCurrency, PurchaseLineCatalogMeta } from "../types";
import { syncLineCostFields } from "./normalizePurchaseLine";
import { switchPurchaseReviewCostCurrency } from "./purchaseLineReview";

/**
 * Borrador LOCAL de la compra en curso (COM-09): lo que se guarda en
 * `localStorage` para ofrecer restaurarlo al volver a `/purchases/create`.
 *
 * No confundir con el "borrador de compra" de `@bodega/core/purchases`
 * (`PurchaseDraftItem`: tipos y cuentas de las líneas). Aquí solo se PERSISTE
 * sobre esos tipos.
 *
 * Nunca se guardan los datos del pago inicial ni la clave de idempotencia.
 * Para extender el esquema (CNF-16): añadir campos OPCIONALES a
 * `storedPurchaseDraftSchema`; un cambio incompatible sube `PURCHASE_DRAFT_VERSION`
 * (y con ella la clave), y los borradores de la versión anterior se descartan.
 */
export const PURCHASE_DRAFT_VERSION = 1;

const KEY_PREFIX = `bodegahub:compras:borrador:v${PURCHASE_DRAFT_VERSION}`;

export type PurchaseDraftSession = { storeId: string | null; userId: string };

/** Clave por tienda y usuario: el borrador de uno no lo ve otro en el mismo navegador. */
export function purchaseDraftStorageKey(session: PurchaseDraftSession) {
  return [
    KEY_PREFIX,
    encodeURIComponent(session.storeId ?? ""),
    encodeURIComponent(session.userId),
  ].join(":");
}

const amountSchema = z.number().nonnegative();
const costCurrencySchema = z.enum(["ves", "ref"]);

const draftItemSchema = z.object({
  costCurrency: costCurrencySchema,
  entryMode: z.enum(["unit", "pack"]),
  id: z.string().min(1),
  packCostRef: amountSchema,
  packCostVes: amountSchema,
  packCount: amountSchema,
  packLabel: z.string(),
  packUnitId: z.string().optional(),
  productId: z.string().min(1),
  quantity: amountSchema,
  taxRate: amountSchema,
  unitCostRef: amountSchema,
  unitCostVes: amountSchema,
  unitsPerPack: amountSchema,
});

const snapshotSchema = z.object({
  item: draftItemSchema,
  taxChoice: z.string().nullable(),
});

const packUnitSchema = z.object({
  id: z.string(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  label: z.string(),
  supplierProductId: z.string(),
  unitsPerPack: z.number().positive(),
});

const lineMetaSchema = z.object({
  name: z.string(),
  packUnits: z.array(packUnitSchema).optional(),
  sku: z.string(),
  taxRate: amountSchema,
});

const storedPurchaseDraftSchema = z.object({
  costCurrency: costCurrencySchema,
  discountRef: amountSchema,
  /** Metadatos para repintar cada línea: `productId` -> nombre, SKU, empaques y % de categoría. */
  lineMeta: z.record(z.string(), lineMetaSchema),
  /** `PurchaseLinesState` sin `focus`. */
  lines: z.object({
    /** Elección «Desarmar al recibir» por línea (COM-14); ausente = ninguna tocada. */
    disassemble: z.record(z.string(), z.boolean()).optional(),
    items: z.array(draftItemSchema),
    locks: z.object({ locked: z.record(z.string(), z.literal(true)) }),
    review: z.object({
      baselines: z.record(z.string(), snapshotSchema),
      reviewed: z.record(z.string(), snapshotSchema),
    }),
    taxState: z.object({
      choices: z.record(z.string(), z.string()),
      exempt: z.boolean(),
    }),
  }),
  notes: z.string(),
  /** Tasa con la que se calcularon los costos guardados; al restaurar manda la vigente. */
  rateVes: z.number().positive(),
  /** ISO 8601. */
  savedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  status: z.enum(["recibido", "pedido"]),
  storeId: z.string().nullable(),
  supplierId: z.string(),
  supplierName: z.string().optional(),
  userId: z.string().min(1),
  version: z.literal(PURCHASE_DRAFT_VERSION),
});

/** Lo que queda escrito en `localStorage`. */
export type StoredPurchaseDraft = z.infer<typeof storedPurchaseDraftSchema>;

/** Lo que aporta el formulario; la sesión, la versión y la fecha las pone quien guarda. */
export type PurchaseDraftContent = Omit<
  StoredPurchaseDraft,
  "savedAt" | "storeId" | "userId" | "version"
>;

/** Hay "algo que perder": al menos una línea, o proveedor y notas. */
export function isPurchaseDraftWorthSaving(content: PurchaseDraftContent) {
  return (
    content.lines.items.length > 0 ||
    (content.supplierId !== "" && content.notes.trim() !== "")
  );
}

export function serializePurchaseDraft(
  content: PurchaseDraftContent,
  session: PurchaseDraftSession,
  savedAt: Date,
) {
  const draft: StoredPurchaseDraft = {
    ...content,
    savedAt: savedAt.toISOString(),
    storeId: session.storeId,
    userId: session.userId,
    version: PURCHASE_DRAFT_VERSION,
  };

  return JSON.stringify(draft);
}

/**
 * Lee un borrador guardado. Devuelve `null`, sin avisar, si no hay nada, si el
 * texto está corrupto, si es de otra versión o si lo guardó otra tienda u otro
 * usuario.
 */
export function parseStoredPurchaseDraft(
  raw: string | null,
  session: PurchaseDraftSession,
): StoredPurchaseDraft | null {
  if (!raw) {
    return null;
  }

  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = storedPurchaseDraftSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  const draft = parsed.data;

  if (draft.storeId !== session.storeId || draft.userId !== session.userId) {
    return null;
  }

  // La moneda de costo es una sola para toda la compra.
  if (draft.lines.items.some((item) => item.costCurrency !== draft.costCurrency)) {
    return null;
  }

  return draft;
}

function pickKeys<TValue>(record: Record<string, TValue>, keys: Set<string>) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));
}

export type RestoredPurchaseDraft = {
  costCurrency: PurchaseCostCurrency;
  lineMeta: Map<string, PurchaseLineCatalogMeta>;
  lines: PurchaseLinesSnapshot;
  /** Avisos para el usuario: tasa distinta de la guardada y productos que se quitaron. */
  notices: string[];
};

/**
 * Prepara un borrador guardado para volver al formulario:
 * - se quitan las líneas cuyo producto ya no existe o está inactivo (y se avisa cuáles);
 * - los costos se sincronizan con la tasa VIGENTE dejando fijo el monto en la moneda
 *   de captura de la compra, también en las fotos de revisión para que el cambio de
 *   tasa no cuente como edición;
 * - nombre, SKU, empaques y % de categoría se toman del catálogo actual.
 */
export function restorePurchaseDraft(
  draft: StoredPurchaseDraft,
  input: { products: PurchaseProductResolutions; rateVes: number },
): RestoredPurchaseDraft {
  const lineMeta = new Map<string, PurchaseLineCatalogMeta>();
  const removedNames = new Map<string, string>();
  const items = draft.lines.items.flatMap((item) => {
    const resolution = input.products.get(item.productId);

    if (resolution?.status !== "active") {
      removedNames.set(
        item.productId,
        resolution?.name ?? draft.lineMeta[item.productId]?.name ?? "Producto sin nombre",
      );
      return [];
    }

    const { name, packUnits, sku, taxRate } = resolution.product;

    lineMeta.set(item.productId, { name, packUnits, sku, taxRate });
    return [syncLineCostFields(item, input.rateVes)];
  });
  const keptIds = new Set(items.map((item) => item.id));
  const disassemble = pickKeys(draft.lines.disassemble ?? {}, keptIds);
  const notices: string[] = [];

  if (roundMoney(draft.rateVes) !== roundMoney(input.rateVes)) {
    notices.push(
      `La tasa cambió desde que guardaste la compra (de ${formatVesBs(draft.rateVes)} a ${formatVesBs(input.rateVes)}): los costos se recalcularon con la tasa actual.`,
    );
  }

  if (removedNames.size > 0) {
    const names = [...removedNames.values()].join(", ");

    notices.push(
      removedNames.size === 1
        ? `Se quitó 1 producto que ya no existe o está inactivo: ${names}.`
        : `Se quitaron ${removedNames.size} productos que ya no existen o están inactivos: ${names}.`,
    );
  }

  return {
    costCurrency: draft.costCurrency,
    lineMeta,
    lines: {
      // La marca vuelve tal cual; si el producto ya no tiene receta, la fila no
      // ofrece el chip y la línea no se envía marcada.
      ...(Object.keys(disassemble).length > 0 ? { disassemble } : {}),
      items,
      locks: { locked: pickKeys(draft.lines.locks.locked, keptIds) },
      review: switchPurchaseReviewCostCurrency(
        {
          baselines: pickKeys(draft.lines.review.baselines, keptIds),
          reviewed: pickKeys(draft.lines.review.reviewed, keptIds),
        },
        draft.costCurrency,
        input.rateVes,
      ),
      taxState: {
        choices: pickKeys(draft.lines.taxState.choices, keptIds),
        exempt: draft.lines.taxState.exempt,
      },
    },
    notices,
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "hace un momento", "hace 20 min", "hace 3 h", "hace 2 días". */
export function formatPurchaseDraftAge(savedAt: string, now: number) {
  const elapsed = Math.max(0, now - Date.parse(savedAt));

  if (elapsed < MINUTE_MS) {
    return "hace un momento";
  }

  if (elapsed < HOUR_MS) {
    return `hace ${Math.floor(elapsed / MINUTE_MS)} min`;
  }

  if (elapsed < DAY_MS) {
    return `hace ${Math.floor(elapsed / HOUR_MS)} h`;
  }

  const days = Math.floor(elapsed / DAY_MS);

  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

/** "Distribuidora X · 12 líneas · guardada hace 20 min". */
export function describeStoredPurchaseDraft(draft: StoredPurchaseDraft, now: number) {
  const lineCount = draft.lines.items.length;

  return [
    draft.supplierName ? `proveedor ${draft.supplierName}` : null,
    lineCount === 1 ? "1 línea" : `${lineCount} líneas`,
    `guardada ${formatPurchaseDraftAge(draft.savedAt, now)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}
