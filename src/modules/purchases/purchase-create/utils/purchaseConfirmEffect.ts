import type { PaymentMethod, PurchaseStatus } from "@/shared/mocks/erp-data";
import {
  type PaymentFormCurrency,
  type PaymentFormPayload,
  paymentAmountEquivalent,
} from "@/shared/payments/PaymentFormFields";
import { amountWithTax, refToVes, roundMoney } from "@/shared/utils/currency";
import { bandDrop, marginBand, type MarginThresholds, markupPct } from "@/shared/utils/pricing";

import type { PurchaseWebLine } from "../types";
import { sumDraftPurchaseTotals } from "./normalizePurchaseLine";

/** Lo que hay que saber HOY de un producto para comparar: no lo guarda el formulario. */
export type PurchaseConfirmProductFacts = {
  /** `products.current_cost_ref` (con IVA). */
  currentCostRef: number;
  /** Vínculo con el proveedor de la compra; `none` = nunca lo tuvo. */
  link: "active" | "inactive" | "none";
  salePriceRef: number;
};

export type PurchaseConfirmFacts = {
  /** Por id de producto; uno que falta no se pudo consultar. */
  products: ReadonlyMap<string, PurchaseConfirmProductFacts>;
  /** Cortes del semáforo de ganancia de la tienda. */
  thresholds: MarginThresholds;
};

/** Lo que se lee de cada receta de `GET /api/inventory/pack-conversions`. */
export type PurchaseConfirmRecipe = {
  components?: ReadonlyArray<{ name: string; unitsPerPack: number }>;
  packProduct?: { id?: string } | null;
};

export type PurchaseConfirmInput = {
  discountRef: number;
  /** `null` / ausente: aún no se sabe (o no se pudo consultar) el costo actual ni los vínculos. */
  facts?: PurchaseConfirmFacts | null;
  getProductName: (productId: string) => string;
  /** Las líneas que se envían (las válidas), tal como las pinta la tabla. */
  lines: readonly PurchaseWebLine[];
  /** Pago inicial ya validado («Pagar ahora»); `null` = la compra se confirma sin pago. */
  payment: PaymentFormPayload | null;
  rateVes: number;
  /** Recetas de apertura activas; sin ellas ninguna línea muestra su desarme. */
  recipes?: ReadonlyArray<PurchaseConfirmRecipe | null> | null;
  status: PurchaseStatus;
  supplierName: string | null;
};

export type PurchaseConfirmCost = {
  /** `current_cost_ref` que fija la compra: neto de la línea + su IVA. */
  afterRef: number;
  /** Costo actual del producto; `null` si no se pudo consultar. */
  beforeRef: number | null;
  /** Solo si la ganancia BAJA de banda con el costo nuevo: el % que queda. */
  marginDrop?: { pct: number | null; previousPct: number | null };
};

export type PurchaseConfirmLine = {
  /** Solo en una compra `recibido`: en un pedido el costo no cambia hasta recibir. */
  cost?: PurchaseConfirmCost;
  /**
   * La línea se desarma al recibir. `components` son las unidades que suben por la
   * receta (vacío si no se conoce); los `packs` que entran vuelven a salir.
   */
  disassemble?: { components: { name: string; units: number }[]; packs: number };
  /** El producto queda vinculado al proveedor por primera vez con esta compra. */
  firstLink: boolean;
  itemId: string;
  name: string;
  /** Línea comprada por empaque: `count` × `unitsPerPack` = `quantity`. */
  pack?: { count: number; label: string; unitsPerPack: number };
  productId: string;
  /** Unidades que entran al stock del producto (las que guarda la línea). */
  quantity: number;
};

/** De dónde sale el dinero de un pago de compra (`register_payment`). */
export type PurchaseConfirmPaymentSource = "vault_account" | "vault_cash_ref" | "vault_cash_ves";

export type PurchaseConfirmPayment = {
  amount: number;
  currency: PaymentFormCurrency;
  /** El mismo monto en la otra moneda, a la tasa de la compra. */
  equivalent: number | null;
  method: PaymentMethod;
  source: PurchaseConfirmPaymentSource;
};

export type PurchaseConfirmEffect = {
  discountRef: number;
  /** `false`: sin costo anterior, banda ni vínculos nuevos (aún cargando o no disponibles). */
  hasFacts: boolean;
  lines: PurchaseConfirmLine[];
  /** Nombres de los productos que se vinculan por primera vez, sin repetir. */
  newLinkNames: string[];
  payment: PurchaseConfirmPayment | null;
  rateVes: number;
  /** `recibido`: stock y costos cambian al confirmar. `false` (pedido): hasta recibir, no. */
  receivesNow: boolean;
  supplierName: string | null;
  /** Cortes del semáforo con los que se decidió qué ganancia baja de banda; sin `facts`, ausente. */
  thresholds?: MarginThresholds;
  totalRef: number;
  totalVes: number;
};

const PAYMENT_SOURCE: Record<PaymentMethod, PurchaseConfirmPaymentSource> = {
  efectivo_usd: "vault_cash_ref",
  efectivo_ves: "vault_cash_ves",
  pago_movil: "vault_account",
  punto_venta: "vault_account",
  transferencia: "vault_account",
};

function buildPayment(
  payment: PaymentFormPayload | null,
  rateVes: number,
): PurchaseConfirmPayment | null {
  if (!payment) {
    return null;
  }

  return {
    amount: payment.amount,
    currency: payment.currency,
    equivalent:
      paymentAmountEquivalent(payment.method, String(payment.amount), rateVes)?.value ?? null,
    method: payment.method,
    source: PAYMENT_SOURCE[payment.method],
  };
}

/**
 * Efecto de confirmar la compra en curso (CNF-01), con las mismas cuentas que la
 * tabla, el resumen y el payload (`sumDraftPurchaseTotals`) y las reglas de
 * `create_purchase`:
 * - `recibido`: cada línea suma su cantidad al stock y fija el costo del producto en
 *   el neto de la línea + su IVA (si el producto se repite, manda la última línea).
 *   Una línea por empaque de un producto que ES el empaque de una receta entra en
 *   empaques, al costo del empaque.
 * - `pedido`: no cambia stock ni costos; las líneas solo dicen cuánto se pidió.
 * - En los dos estados, el producto que el proveedor no tenía queda vinculado.
 *
 * Función pura: no consulta nada. `facts` (costo actual, precio y vínculos de hoy)
 * llega aparte; sin él el efecto no compara, pero lo que entra y lo que se paga sí está.
 */
export function buildPurchaseConfirmEffect(input: PurchaseConfirmInput): PurchaseConfirmEffect {
  const { facts, rateVes } = input;
  const receivesNow = input.status === "recibido";
  // Como `readPurchasePackRecipes`: una respuesta que no sea la lista esperada no da recetas.
  const recipes: ReadonlyArray<PurchaseConfirmRecipe | null> = Array.isArray(input.recipes)
    ? input.recipes
    : [];
  const recipeByPackId = new Map(
    recipes.flatMap((recipe) =>
      recipe?.packProduct?.id ? [[recipe.packProduct.id, recipe] as const] : [],
    ),
  );
  // Costo con el que llega cada producto a su línea: el de hoy o el de una línea anterior.
  const runningCost = new Map<string, number>();
  const newLinkNames: string[] = [];

  const lines = input.lines.map(({ disassemble, item }): PurchaseConfirmLine => {
    const name = input.getProductName(item.productId);
    const known = facts?.products.get(item.productId);
    const recipe = recipeByPackId.get(item.productId);
    const isPackLine = item.entryMode === "pack";
    // El producto ES el empaque: su stock se cuenta en empaques, al costo del empaque.
    const entersAsPacks = isPackLine && recipe !== undefined;
    const quantity = entersAsPacks ? item.packCount : item.quantity;
    const firstLink = known?.link === "none";
    const line: PurchaseConfirmLine = {
      firstLink,
      itemId: item.id,
      name,
      productId: item.productId,
      quantity,
    };

    if (firstLink && !newLinkNames.includes(name)) {
      newLinkNames.push(name);
    }

    if (isPackLine && !entersAsPacks) {
      line.pack = {
        count: item.packCount,
        label: item.packLabel.trim(),
        unitsPerPack: item.unitsPerPack,
      };
    }

    if (disassemble === true && recipe) {
      line.disassemble = {
        components: (recipe.components ?? []).map((component) => ({
          name: component.name,
          units: component.unitsPerPack * quantity,
        })),
        packs: quantity,
      };
    }

    if (receivesNow) {
      const afterRef = amountWithTax(
        entersAsPacks ? item.packCostRef : item.unitCostRef,
        item.taxRate,
      );
      const beforeRef = runningCost.get(item.productId) ?? known?.currentCostRef ?? null;

      line.cost = { afterRef, beforeRef };
      runningCost.set(item.productId, afterRef);

      if (facts && known && beforeRef !== null) {
        const previousPct = markupPct(beforeRef, known.salePriceRef);
        const pct = markupPct(afterRef, known.salePriceRef);

        if (
          bandDrop(
            marginBand(previousPct, facts.thresholds),
            marginBand(pct, facts.thresholds),
          )
        ) {
          line.cost.marginDrop = { pct, previousPct };
        }
      }
    }

    return line;
  });

  const totals = sumDraftPurchaseTotals(
    input.lines.map((line) => line.item),
    rateVes,
  );
  const discountVes = roundMoney(refToVes(input.discountRef, rateVes));

  return {
    discountRef: input.discountRef,
    hasFacts: Boolean(facts),
    lines,
    newLinkNames,
    payment: buildPayment(input.payment, rateVes),
    rateVes,
    receivesNow,
    supplierName: input.supplierName,
    ...(facts ? { thresholds: facts.thresholds } : {}),
    totalRef: Math.max(0, roundMoney(totals.subtotalRef - input.discountRef + totals.taxRef)),
    totalVes: Math.max(0, roundMoney(totals.subtotalVes - discountVes + totals.taxVes)),
  };
}

/**
 * Huella de lo que el modal muestra, sin lo consultado (`facts`): si cambia con el
 * modal abierto (llegó un escaneo, cambió la tasa), esas cifras ya no son las que
 * se enviarían y el modal se cierra.
 */
export function purchaseConfirmKey(input: PurchaseConfirmInput) {
  return JSON.stringify(buildPurchaseConfirmEffect({ ...input, facts: null }));
}
