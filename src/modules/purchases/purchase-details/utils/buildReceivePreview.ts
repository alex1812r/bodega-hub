import type { ProductMock, PurchaseItemMock } from "@/shared/mocks/erp-data";

/** Lo que `buildReceivePreview` necesita de una compra: sus líneas con el producto embebido. */
export type ReceivePreviewPurchase = {
  items: ReadonlyArray<
    PurchaseItemMock & {
      product?: Pick<ProductMock, "currentStock" | "isActive" | "name">;
    }
  >;
};

export type ReceivePreviewLine = {
  /** Nombre del producto; si la línea llega sin producto embebido, su id. */
  name: string;
  /** Empaques de la línea. Solo en líneas guardadas por empaque. */
  packCount?: number;
  /** Nombre del empaque ("caja", "bulto"). Solo en líneas guardadas por empaque. */
  packLabel?: string;
  /** El producto está inactivo: recibir se permite igualmente (decisión COM-15). */
  productInactive: boolean;
  productId: string;
  /** Unidades que entran al inventario (en una línea por empaque, empaques × unidades). */
  quantityIn: number;
  /** `stockBefore + quantityIn`; `null` si no se conoce el stock del producto. */
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
 * Previsualización de lo que entra al inventario al recibir un pedido: una
 * entrada por línea de la compra, en su mismo orden.
 *
 * Función pura, sin efectos: no escribe stock ni consulta nada; parte del
 * `currentStock` que trae cada producto en el detalle de la compra. La usa el
 * modal «Recibir mercancía» del detalle de compra (COM-07) y está pensada para
 * que el módulo de Confirmaciones (CNF-04) la consuma tal cual al construir los
 * efectos de su modal definitivo, sin recalcular cantidades ni stock.
 */
export function buildReceivePreview(purchase: ReceivePreviewPurchase): ReceivePreviewLine[] {
  const runningStock = new Map<string, number>();

  return purchase.items.map((item) => {
    const knownStock = runningStock.get(item.productId) ?? item.product?.currentStock;
    const stockBefore = knownStock ?? null;
    const stockAfter = stockBefore === null ? null : stockBefore + item.quantity;

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
