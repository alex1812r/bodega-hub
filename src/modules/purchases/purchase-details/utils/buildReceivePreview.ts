import type { ProductMock, PurchaseItemMock } from "@/shared/mocks/erp-data";

import type {
  PurchaseItemDisassemble,
  ReceiveDisassembleEntry,
} from "../../services/purchaseDisassemble";

/** Lo que `buildReceivePreview` necesita de una compra: sus líneas con el producto embebido. */
export type ReceivePreviewPurchase = {
  items: ReadonlyArray<
    PurchaseItemMock &
      PurchaseItemDisassemble & {
        product?: Pick<ProductMock, "currentStock" | "isActive" | "name">;
      }
  >;
};

export type ReceivePreviewOptions = {
  /**
   * Qué líneas se desarman al recibir: `purchaseItemId` -> sí / no. Una línea sin
   * entrada usa la marca «Desarmar al recibir» guardada con el pedido.
   */
  disassemble?: Readonly<Record<string, boolean>>;
};

/** Lo que recibe un componente al abrirse los empaques de una línea. */
export type ReceivePreviewComponent = {
  name: string;
  /** El componente está inactivo: recibe las unidades igualmente. */
  productInactive: boolean;
  productId: string;
  /** Unidades que entran: unidades por empaque × empaques de la línea. */
  quantityIn: number;
  stockAfter: number;
  /** Stock del componente antes de esta apertura (ya con lo que le sumaron líneas anteriores). */
  stockBefore: number;
};

/** Segundo efecto de una línea que se desarma al recibir: el empaque sale y entran sus componentes. */
export type ReceivePreviewDisassemble = {
  /** Una entrada por componente de la receta, por nombre. */
  components: ReceivePreviewComponent[];
  /** Empaques que salen al abrirse: los mismos que entran (el empaque queda neto 0). */
  packsOut: number;
};

export type ReceivePreviewLine = {
  /**
   * `true` si la línea se puede desarmar al recibir: su producto es un empaque con
   * receta activa. Ausente si no.
   */
  canDisassemble?: boolean;
  /** Presente solo si la línea SE DESARMA al recibir (marcada y con receta). */
  disassemble?: ReceivePreviewDisassemble;
  /**
   * `true` si la línea se guardó marcada pero su producto ya no tiene receta
   * activa: se recibe sin desarmar. Ausente si no.
   */
  disassembleUnavailable?: boolean;
  /** Nombre del producto; si la línea llega sin producto embebido, su id. */
  name: string;
  /** Empaques de la línea. Solo en líneas guardadas por empaque. */
  packCount?: number;
  /** Nombre del empaque ("caja", "bulto"). Solo en líneas guardadas por empaque. */
  packLabel?: string;
  /** El producto está inactivo: recibir se permite igualmente (decisión COM-15). */
  productInactive: boolean;
  productId: string;
  /** Id de la línea de compra, si el detalle lo trae. */
  purchaseItemId?: string;
  /** Unidades que entran al inventario (en una línea por empaque, empaques × unidades). */
  quantityIn: number;
  /**
   * Stock del producto tras la línea; `null` si no se conoce. Sin desarme,
   * `stockBefore + quantityIn`; si la línea se desarma, lo que entra vuelve a
   * salir: `stockBefore`.
   */
  stockAfter: number | null;
  /**
   * Stock del producto antes de esta línea; `null` si la línea llega sin producto
   * embebido. Si el producto se repite en varias líneas, cada una parte del
   * `stockAfter` de la anterior.
   */
  stockBefore: number | null;
  /** Costo por unidad de la línea, sin impuesto (el `unitCostRef` de la línea). */
  unitCostRef: number;
  /** Unidades por empaque. Solo en líneas guardadas por empaque. */
  unitsPerPack?: number;
};

/**
 * Previsualización de lo que pasa en el inventario al recibir un pedido: una
 * entrada por línea de la compra, en su mismo orden, con sus DOS efectos:
 * 1. lo que entra (cantidad, stock antes → después, costo);
 * 2. si la línea se desarma al recibir (COM-14), `disassemble`: los empaques que
 *    salen y lo que sube cada componente de la receta, con su stock antes → después.
 *
 * Función pura, sin efectos: no escribe stock ni consulta nada; parte del
 * `currentStock` que trae cada producto (y cada componente de la receta) en el
 * detalle de la compra. El stock se encadena línea a línea: un componente que
 * además es una línea de la compra, o que sale de dos empaques, acumula. Las
 * cantidades finales son las de la base (recibir todo y abrir después suma lo mismo).
 *
 * La usa el modal «Recibir mercancía» del detalle de compra (COM-07) y está
 * pensada para que el módulo de Confirmaciones (CNF-04) la consuma tal cual al
 * construir los efectos de su modal definitivo, sin recalcular cantidades ni stock.
 */
export function buildReceivePreview(
  purchase: ReceivePreviewPurchase,
  options: ReceivePreviewOptions = {},
): ReceivePreviewLine[] {
  const runningStock = new Map<string, number>();

  return purchase.items.map((item) => {
    const knownStock = runningStock.get(item.productId) ?? item.product?.currentStock;
    const stockBefore = knownStock ?? null;
    const recipe = item.id ? item.packRecipe : undefined;
    const marked = (item.id ? options.disassemble?.[item.id] : undefined) ?? item.disassembleOnReceive === true;
    const disassembles = Boolean(recipe) && marked;
    // Al desarmarse, los empaques que entran vuelven a salir.
    const stockAfter =
      stockBefore === null ? null : disassembles ? stockBefore : stockBefore + item.quantity;

    if (stockAfter !== null) {
      runningStock.set(item.productId, stockAfter);
    }

    const line: ReceivePreviewLine = {
      name: item.product?.name ?? item.productId,
      productId: item.productId,
      productInactive: item.product?.isActive === false,
      quantityIn: item.quantity,
      stockAfter,
      stockBefore,
      unitCostRef: item.unitCostRef,
    };

    if (item.id) {
      line.purchaseItemId = item.id;
    }

    if (recipe) {
      line.canDisassemble = true;
    } else if (item.disassembleOnReceive === true) {
      line.disassembleUnavailable = true;
    }

    if (recipe && disassembles) {
      line.disassemble = {
        components: recipe.components.map((component) => {
          const before = runningStock.get(component.unitProductId) ?? component.currentStock;
          const quantityIn = component.unitsPerPack * item.quantity;

          runningStock.set(component.unitProductId, before + quantityIn);

          return {
            name: component.name,
            productId: component.unitProductId,
            productInactive: !component.isActive,
            quantityIn,
            stockAfter: before + quantityIn,
            stockBefore: before,
          };
        }),
        packsOut: item.quantity,
      };
    }

    if (item.entryMode === "pack" && item.packCount && item.unitsPerPack) {
      line.packCount = item.packCount;
      line.unitsPerPack = item.unitsPerPack;

      if (item.packLabel) {
        line.packLabel = item.packLabel;
      }
    }

    return line;
  });
}

/**
 * Lista `disassemble` del cuerpo de `PATCH /api/purchases/{id}/receive` para lo
 * que muestra la previsualización: las líneas que se desarman, con su receta.
 * `undefined` (no enviar la lista) si ninguna línea se puede desarmar ni estaba
 * marcada: la recepción es la de siempre.
 */
export function buildReceiveDisassembleRequest(
  lines: readonly ReceivePreviewLine[],
): ReceiveDisassembleEntry[] | undefined {
  if (!lines.some((line) => line.canDisassemble || line.disassembleUnavailable)) {
    return undefined;
  }

  return lines.flatMap((line) =>
    line.disassemble && line.purchaseItemId ? [{ purchaseItemId: line.purchaseItemId }] : [],
  );
}
