/**
 * Reglas puras de la reposición (INV-05): cuánto pedir de cada producto por
 * reponer, a qué proveedor y cómo se reparten los productos elegidos en compras
 * (una compra = un proveedor).
 */

/** Proveedor de una compra de reposición. */
export type RestockSupplier = {
  id: string;
  name: string;
};

/** Proveedor resuelto para un producto, con el último costo que cobró por él. */
export type RestockSupplierChoice = RestockSupplier & {
  /** REF por unidad; ausente si el vínculo no tiene costo (0 = sin costo). */
  lastCostRef?: number;
};

/** Lo que se lee de cada fila de `GET /api/products/{id}/suppliers`. */
export type RestockSupplierLink = {
  isActive?: boolean;
  isPreferred?: boolean;
  lastCostRef?: number;
  lastPurchasedAt?: string | null;
  supplier?: { id: string; isActive?: boolean; name: string } | null;
  supplierId: string;
};

/** Una línea de la compra de reposición (la forma del contrato INV-05). */
export type RestockLine = {
  currentStock: number;
  /** REF por unidad del último costo del proveedor de la compra; es una pista, no el costo. */
  lastCostRef?: number;
  minStock: number;
  name: string;
  productId: string;
  sku: string;
  /** Entero ≥ 1. */
  suggestedQuantity: number;
};

export type RestockGroupEntry = {
  line: RestockLine;
  /** `null` = el producto no tiene proveedor habitual ni compra previa. */
  supplier: RestockSupplier | null;
};

/** Productos elegidos de un mismo proveedor: lo que entra en UNA compra. */
export type RestockGroup = {
  /** Id del proveedor, o `RESTOCK_NO_SUPPLIER_KEY`. */
  key: string;
  lines: RestockLine[];
  supplier: RestockSupplier | null;
  /** Σ de `suggestedQuantity`. */
  totalUnits: number;
};

export const RESTOCK_NO_SUPPLIER_KEY = "sin-proveedor";
export const RESTOCK_NO_SUPPLIER_LABEL = "Sin proveedor";

/**
 * Cantidad sugerida = `mínimo × 2 − stock`, entera y nunca menor que 1. El
 * stock negativo cuenta como es (mínimo 5, stock −3 → 13); con mínimo 0 se
 * sugiere 1. Un resultado con decimales se redondea hacia arriba.
 */
export function suggestRestockQuantity(minStock: number, currentStock: number): number {
  const needed = minStock * 2 - currentStock;

  if (!Number.isFinite(needed)) {
    return 1;
  }

  return Math.max(Math.ceil(needed), 1);
}

/** Cantidad que se puede enviar a la compra: entero ≥ 1. */
export function isValidRestockQuantity(quantity: number | null | undefined): quantity is number {
  return typeof quantity === "number" && Number.isInteger(quantity) && quantity >= 1;
}

function purchasedAtMs(link: RestockSupplierLink): number | null {
  if (!link.lastPurchasedAt) {
    return null;
  }

  const ms = Date.parse(link.lastPurchasedAt);

  return Number.isNaN(ms) ? null : ms;
}

function isUsableLink(link: RestockSupplierLink) {
  return (
    link.isActive !== false &&
    Boolean(link.supplier) &&
    link.supplier?.isActive !== false &&
    (link.supplier?.name ?? "").trim() !== ""
  );
}

/**
 * Proveedor de un producto: el habitual (`isPreferred`); si no hay, el de la
 * compra más reciente (`lastPurchasedAt`); si tampoco, ninguno (`null`). No se
 * consideran vínculos inactivos ni proveedores inactivos. A igual fecha gana el
 * nombre (y luego el id), para que el resultado no dependa del orden de llegada.
 */
export function pickRestockSupplier(
  links: readonly RestockSupplierLink[],
): RestockSupplierChoice | null {
  const usable = links.filter(isUsableLink);
  const preferred = usable.find((link) => link.isPreferred === true);
  const chosen =
    preferred ??
    usable
      .map((link) => ({ link, ms: purchasedAtMs(link) }))
      .filter((entry): entry is { link: RestockSupplierLink; ms: number } => entry.ms !== null)
      .sort(
        (a, b) =>
          b.ms - a.ms ||
          (a.link.supplier?.name ?? "").localeCompare(b.link.supplier?.name ?? "", "es") ||
          a.link.supplierId.localeCompare(b.link.supplierId),
      )[0]?.link;

  if (!chosen?.supplier) {
    return null;
  }

  const hasCost =
    typeof chosen.lastCostRef === "number" &&
    Number.isFinite(chosen.lastCostRef) &&
    chosen.lastCostRef > 0;

  return {
    id: chosen.supplier.id,
    name: chosen.supplier.name,
    ...(hasCost ? { lastCostRef: chosen.lastCostRef } : {}),
  };
}

/**
 * Reparte los productos elegidos por proveedor. Los grupos salen por nombre de
 * proveedor y "Sin proveedor" al final; dentro de cada grupo se conserva el
 * orden de entrada.
 */
export function groupRestockLines(entries: readonly RestockGroupEntry[]): RestockGroup[] {
  const groups = new Map<string, RestockGroup>();

  for (const { line, supplier } of entries) {
    const key = supplier?.id ?? RESTOCK_NO_SUPPLIER_KEY;
    const group = groups.get(key) ?? { key, lines: [], supplier, totalUnits: 0 };

    group.lines.push(line);
    group.totalUnits += line.suggestedQuantity;
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.supplier === null || b.supplier === null) {
      return a.supplier === b.supplier ? 0 : a.supplier === null ? 1 : -1;
    }

    return a.supplier.name.localeCompare(b.supplier.name, "es") || a.key.localeCompare(b.key);
  });
}

export function getRestockGroupLabel(group: Pick<RestockGroup, "supplier">) {
  return group.supplier?.name ?? RESTOCK_NO_SUPPLIER_LABEL;
}
