import type { ImpactPaymentLine } from "@/shared/impact/types";
import type { PurchaseItemMock, PurchaseStatus } from "@/shared/mocks/erp-data";
import { roundMoney } from "@/shared/utils/currency";

import type { PurchaseItemDisassemble } from "../services/purchaseDisassemble";
import type {
  PurchaseImpact,
  PurchaseImpactAction,
  PurchaseImpactCostLine,
  PurchaseImpactDisassembleEntry,
  PurchaseImpactStockLine,
} from "../services/purchaseImpact";

/** Datos de prueba de los modales de recibir / cancelar / devolver compra. Solo para jest y stories. */

export const IMPACT_PURCHASE_ID = "purchase-cnf";
export const IMPACT_PURCHASE_NUMBER = "C-20261009-000007";

export const PURCHASE_PAYMENTS_BLOCKED_REASON =
  "La compra C-20261009-000007 tiene 1 pago(s) activo(s) por Bs 5000.00. Anula los pagos antes de cancelarla o devolverla.";
export const PURCHASE_STOCK_BLOCKED_REASON = "No hay stock suficiente para revertir la compra";

export function purchaseImpactStockLine(
  overrides: Partial<PurchaseImpactStockLine> = {},
): PurchaseImpactStockLine {
  return {
    componentsIn: 0,
    disassembledOut: 0,
    inexact: null,
    isActive: true,
    productId: "prod-harina",
    productName: "Harina PAN 1 kg",
    purchasedIn: 0,
    quantityDelta: -5,
    sku: "HAR-1",
    stockAfter: 10,
    stockBefore: 15,
    ...overrides,
  };
}

export function purchaseImpactCostLine(
  overrides: Partial<PurchaseImpactCostLine> = {},
): PurchaseImpactCostLine {
  return {
    costRefAfter: 2.32,
    costRefBefore: 2,
    inexact: null,
    isActive: true,
    productId: "prod-harina",
    productName: "Harina PAN 1 kg",
    sku: "HAR-1",
    source: "purchase_line",
    ...overrides,
  };
}

export function purchaseImpactPaymentLine(
  overrides: Partial<ImpactPaymentLine> = {},
): ImpactPaymentLine {
  return {
    amount: 5000,
    amountRef: 10,
    amountVes: 5000,
    changeVes: 0,
    currency: "VES",
    description: "Sigue activo: hay que anularlo antes.",
    effects: [],
    inexact: null,
    method: "transferencia",
    netVes: 5000,
    outcome: "blocks_action",
    paymentId: "pay-1",
    status: "activo",
    statusAfter: "activo",
    ...overrides,
  };
}

const STATUS_AFTER: Record<PurchaseImpactAction, PurchaseStatus> = {
  cancel: "cancelado",
  receive: "recibido",
  return: "devuelto",
};

type ImpactOverrides = Partial<
  Pick<
    PurchaseImpact,
    | "blockingProducts"
    | "costs"
    | "disassemble"
    | "inexact"
    | "payments"
    | "paymentsRestricted"
    | "stock"
  >
> & { status?: PurchaseStatus };

/** Impact permitido: sin pagos; al cancelar / devolver una compra recibida sale un producto. */
export function allowedPurchaseImpact(
  action: PurchaseImpactAction,
  { status = action === "receive" ? "pedido" : "recibido", ...overrides }: ImpactOverrides = {},
): PurchaseImpact {
  return {
    action,
    allowed: true,
    blockingProducts: [],
    costs: [],
    disassemble: [],
    document: {
      contactName: "Distribuidora Polar",
      id: IMPACT_PURCHASE_ID,
      number: IMPACT_PURCHASE_NUMBER,
      status,
      statusAfter: STATUS_AFTER[action],
    },
    inexact: null,
    payments: [],
    paymentsRestricted: false,
    reason: null,
    reasonCode: null,
    stock: action === "receive" || status !== "recibido" ? [] : [purchaseImpactStockLine()],
    ...overrides,
  };
}

/** Impact rechazado: no proyecta nada (estado "después" = "antes", sin stock ni costos). */
export function rejectedPurchaseImpact(
  action: PurchaseImpactAction,
  reason: string,
  { status = action === "receive" ? "pedido" : "recibido", ...overrides }: ImpactOverrides = {},
): PurchaseImpact {
  return {
    action,
    allowed: false,
    blockingProducts: [],
    costs: [],
    disassemble: [],
    document: {
      contactName: "Distribuidora Polar",
      id: IMPACT_PURCHASE_ID,
      number: IMPACT_PURCHASE_NUMBER,
      status,
      statusAfter: status,
    },
    inexact: null,
    payments: [],
    paymentsRestricted: false,
    reason,
    reasonCode: "CONFLICT",
    stock: [],
    ...overrides,
  };
}

type ReceiveFixturePurchase = {
  items: ReadonlyArray<
    PurchaseItemMock &
      PurchaseItemDisassemble & {
        product?: {
          currentCostRef?: number;
          currentStock: number;
          isActive?: boolean;
          name: string;
          sku?: string;
        };
      }
  >;
};

/**
 * Impact de `receive` de una compra de prueba, con las reglas de la RPC que las
 * pantallas pintan: cada línea suma al stock de su producto y fija su costo
 * (línea con IVA); la línea que se desarma vuelve a sacar sus empaques y reparte
 * sus unidades (reparto enviado o receta) entre los componentes.
 *
 * `disassemble` es la lista que viajaría en la recepción; sin ella valen las
 * marcas guardadas con el pedido.
 */
export function receiveImpactOf(
  purchase: ReceiveFixturePurchase,
  disassemble?: readonly PurchaseImpactDisassembleEntry[] | null,
): PurchaseImpact {
  const stock = new Map<string, PurchaseImpactStockLine>();
  const costs = new Map<string, PurchaseImpactCostLine>();
  const opened: PurchaseImpact["disassemble"] = [];

  function stockOf(productId: string, name: string, currentStock: number, isActive: boolean) {
    const line =
      stock.get(productId) ??
      purchaseImpactStockLine({
        isActive,
        productId,
        productName: name,
        quantityDelta: 0,
        sku: null,
        stockAfter: currentStock,
        stockBefore: currentStock,
      });

    stock.set(productId, line);

    return line;
  }

  for (const item of purchase.items) {
    const name = item.product?.name ?? item.productId;
    const isActive = item.product?.isActive !== false;
    const line = stockOf(item.productId, name, item.product?.currentStock ?? 0, isActive);

    line.purchasedIn += item.quantity;
    costs.set(
      item.productId,
      purchaseImpactCostLine({
        costRefAfter: roundMoney(item.unitCostRef * (1 + (item.taxRate ?? 0) / 100)),
        costRefBefore: costs.get(item.productId)?.costRefBefore ?? item.product?.currentCostRef ?? null,
        isActive,
        productId: item.productId,
        productName: name,
        sku: null,
      }),
    );

    const entry = disassemble?.find((candidate) => candidate.purchaseItemId === item.id);
    const opens = disassemble ? Boolean(entry) : Boolean(item.disassembleOnReceive);

    if (!opens || !item.packRecipe || !item.id) {
      continue;
    }

    line.disassembledOut += item.quantity;
    opened.push({
      components: item.packRecipe.components.map((component) => {
        const unitsIn =
          entry?.distribution?.find((part) => part.unitProductId === component.unitProductId)
            ?.units ?? component.unitsPerPack * item.quantity;
        const target = stockOf(
          component.unitProductId,
          component.name,
          component.currentStock,
          component.isActive,
        );
        const stockBefore = (target.stockBefore ?? 0) + target.componentsIn;

        target.componentsIn += unitsIn;

        return {
          isActive: component.isActive,
          productId: component.unitProductId,
          productName: component.name,
          sku: null,
          stockAfter: stockBefore + unitsIn,
          stockBefore,
          unitsIn,
        };
      }),
      packProductId: item.productId,
      packProductName: name,
      packsOut: item.quantity,
      purchaseItemId: item.id,
    });
  }

  for (const line of stock.values()) {
    line.quantityDelta = line.purchasedIn - line.disassembledOut + line.componentsIn;
    line.stockAfter = (line.stockBefore ?? 0) + line.quantityDelta;
  }

  return allowedPurchaseImpact("receive", {
    costs: [...costs.values()],
    disassemble: opened,
    stock: [...stock.values()],
  });
}

/** `receiveImpactOf` para la URL que pidió el modal: lee de ella la lista `disassemble`. */
export function receiveImpactOfUrl(url: string, purchase: ReceiveFixturePurchase): PurchaseImpact {
  const list = new URL(url, "http://localhost").searchParams.get("disassemble");

  return receiveImpactOf(
    purchase,
    list === null ? null : (JSON.parse(list) as PurchaseImpactDisassembleEntry[]),
  );
}
