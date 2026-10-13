/**
 * Efecto de anular (`cancel_sale`) o devolver (`return_sale`) una venta,
 * calculado SIN escribir (CNF-14). Función pura: el cargador real
 * (`saleImpact.server.ts`) y el del mock (`saleImpact.mock-server.ts`) solo
 * leen y le pasan los datos; el cálculo es el mismo en los dos.
 *
 * Reproduce, paso a paso y en su mismo orden, las versiones vigentes de
 * `cancel_sale` (20261006g), `return_sale` (20261006b) y `cancel_payment_apply`
 * (20261006h). Detalle y citas: `.notes/ux-mejoras/confirmaciones/CNF-14-diseno.md`.
 */
import {
  firstInexact,
  fromCents,
  impactAllowed,
  impactRejected,
  toCents,
} from "@/shared/impact/impactVerdict";
import type {
  ImpactDocument,
  ImpactInexact,
  ImpactMethodAmount,
  ImpactMoneyEffect,
  ImpactPaymentLine,
  ImpactStockLine,
  ImpactVerdict,
} from "@/shared/impact/types";
import type { PaymentMethod, PaymentStatus, SaleStatus } from "@/shared/mocks/erp-data";
import { formatVesBs } from "@/shared/utils/currency";

export const SALE_IMPACT_ACTIONS = ["cancel", "return"] as const;

export type SaleImpactAction = (typeof SALE_IMPACT_ACTIONS)[number];

export type SaleImpactCashMovement = {
  amountRef: number;
  amountVes: number;
  paymentId: string;
  registerName: string | null;
  sessionId: string;
  sessionStatus: "closed" | "open";
  type: string;
  /** `cash_sessions.vault_transferred_at`: el cierre de esa sesión ya viajó al baúl. */
  vaultTransferredAt: string | null;
};

export type SaleImpactVaultMovement = {
  amountVes: number;
  id: string;
  paymentId: string;
  type: string;
  vaultId: string;
};

/**
 * Asientos de caja y baúl de los pagos de la venta. `unavailable`: la fuente
 * no los tiene (modo demo); cada pago activo sale entonces como `inexact`.
 */
export type SaleImpactLedger =
  | {
      cashMovements: SaleImpactCashMovement[];
      /**
       * Lo que el llamante NO puede ver (AUD-01). Ausente = ve todo. Con
       * `vault` el cargador no lee `store_vaults` y el asiento de baúl sale sin
       * saldos; con `cash`, el de caja sale sin nombre de caja ni notas.
       */
      hidden?: { cash: boolean; vault: boolean };
      kind: "full";
      /** Baúl de la tienda (`store_vaults`); `balanceVes` es la cubeta "cuenta". */
      vault: { balanceVes: number; id: string } | null;
      vaultMovements: SaleImpactVaultMovement[];
    }
  | { kind: "unavailable"; reason: string };

export type SaleImpactInputs = {
  action: SaleImpactAction;
  items: Array<{ productId: string; quantity: number }>;
  ledger: SaleImpactLedger;
  payments: Array<{
    amount: number;
    amountRef: number;
    amountVes: number;
    changeMethod: PaymentMethod | null;
    changeRef: number;
    changeVes: number;
    createdAt: string;
    currency: "USD" | "VES";
    id: string;
    method: PaymentMethod;
    status: PaymentStatus;
  }>;
  /** Productos de las líneas que existen en la tienda de la venta. */
  products: Array<{
    currentStock: number;
    id: string;
    isActive: boolean;
    name: string;
    sku: string | null;
  }>;
  /** Σ `quantity_delta` de los movimientos `devolucion_cliente` de la venta, por producto. */
  returnedByProduct: Record<string, number>;
  sale: {
    customerName: string | null;
    id: string;
    invoiceNumber: string;
    paidVes: number;
    status: SaleStatus;
  };
};

/** Respuesta de `GET /api/sales/[id]/impact?action=cancel|return`. */
export type SaleImpact = ImpactVerdict & {
  action: SaleImpactAction;
  document: ImpactDocument<SaleStatus>;
  /** Resumen: primera parte (pago o producto) que no se pudo calcular con exactitud. */
  inexact: ImpactInexact | null;
  /** Cobrado hoy en la venta, en Bs. El modal exige teclear ANULAR si es > 0. */
  paidVes: number;
  paidVesAfter: number;
  payments: ImpactPaymentLine[];
  /**
   * Solo en `return` permitido: dinero que sale con la venta. `byMethod` es lo
   * recibido del cliente por método; `changeToRecover`, el vuelto que se le
   * entregó por método; `netVes` = Σ neto de los pagos que se anulan.
   */
  refund: {
    byMethod: ImpactMethodAmount[];
    changeToRecover: ImpactMethodAmount[];
    netVes: number;
  } | null;
  stock: ImpactStockLine[];
};

const BANK_METHODS: readonly PaymentMethod[] = ["pago_movil", "transferencia", "punto_venta"];

/** Signo de cada tipo de `cash_movements` sobre la sesión y si mueve la gaveta. */
const CASH_MOVEMENT_KINDS: Record<string, { physical: boolean; sign: -1 | 1 }> = {
  account_in: { physical: false, sign: 1 },
  account_out: { physical: false, sign: -1 },
  adjustment: { physical: true, sign: 1 },
  change_out: { physical: true, sign: -1 },
  refund_out: { physical: true, sign: -1 },
  sale_in: { physical: true, sign: 1 },
  transfer_out: { physical: true, sign: -1 },
};

const MESSAGES = {
  alreadyClosed: "La venta ya fue cancelada o devuelta",
  cancelOnlyLive: "Solo se pueden cancelar ventas pagadas o pendientes de pago",
  closureTransferred:
    "No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo",
  paymentExceedsSale: "El monto del pago excede lo registrado en la venta",
  returnOnlyLive: "Solo se pueden devolver ventas pagadas o pendientes de pago",
} as const;

type PaymentInput = SaleImpactInputs["payments"][number];
type FullLedger = Extract<SaleImpactLedger, { kind: "full" }>;

function basePaymentLine(payment: PaymentInput): Omit<
  ImpactPaymentLine,
  "description" | "effects" | "inexact" | "outcome" | "statusAfter"
> {
  return {
    amount: payment.amount,
    amountRef: payment.amountRef,
    amountVes: payment.amountVes,
    changeVes: payment.changeVes,
    currency: payment.currency,
    method: payment.method,
    netVes: fromCents(toCents(payment.amountVes) - toCents(payment.changeVes)),
    paymentId: payment.id,
    status: payment.status,
  };
}

function staticPaymentLine(
  payment: PaymentInput,
  outcome: "already_cancelled" | "blocks_action" | "unchanged",
  description: string,
): ImpactPaymentLine {
  return {
    ...basePaymentLine(payment),
    description,
    effects: [],
    inexact: null,
    outcome,
    statusAfter: payment.status,
  };
}

function cancelledPaymentLine(payment: PaymentInput) {
  return staticPaymentLine(payment, "already_cancelled", "Ya estaba anulado: nada que revertir.");
}

/** Orden de `return_sale`: `order by created_at, id`. */
function byCreation(left: PaymentInput, right: PaymentInput) {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function isLive(status: SaleStatus) {
  return status === "pagada" || status === "pendiente_pago";
}

/** Guarda de estado común a las dos RPC (primer rechazo tras encontrar la venta). */
function statusVerdict(action: SaleImpactAction, status: SaleStatus): ImpactVerdict {
  if (status === "cancelada" || status === "devuelta") {
    return impactRejected("CONFLICT", MESSAGES.alreadyClosed);
  }

  if (!isLive(status)) {
    return impactRejected(
      "CONFLICT",
      action === "cancel" ? MESSAGES.cancelOnlyLive : MESSAGES.returnOnlyLive,
    );
  }

  return impactAllowed();
}

/** Unidades por producto, en el orden de la primera línea de cada uno. */
function soldByProduct(items: SaleImpactInputs["items"]) {
  const sold = new Map<string, number>();

  for (const item of items) {
    sold.set(item.productId, (sold.get(item.productId) ?? 0) + item.quantity);
  }

  return sold;
}

/**
 * Stock que repone la acción: por producto, vendido − ya devuelto con
 * `devolucion_cliente` (R1 / C15). El trigger del libro fija
 * `stock_after = current_stock + delta`; no mira si el producto está activo.
 */
function buildStock(inputs: SaleImpactInputs, project: boolean) {
  const products = new Map(inputs.products.map((product) => [product.id, product]));
  const missing: string[] = [];
  const lines: ImpactStockLine[] = [];

  for (const [productId, sold] of soldByProduct(inputs.items)) {
    const product = products.get(productId);

    if (!product) {
      missing.push(productId);
      lines.push({
        inexact: { reason: "El producto ya no existe en la tienda: no se puede leer su stock." },
        isActive: null,
        productId,
        productName: null,
        quantityDelta: 0,
        sku: null,
        stockAfter: null,
        stockBefore: null,
      });
      continue;
    }

    const pending = Math.max(sold - (inputs.returnedByProduct[productId] ?? 0), 0);
    const quantityDelta = project ? pending : 0;

    lines.push({
      inexact: null,
      isActive: product.isActive,
      productId,
      productName: product.name,
      quantityDelta,
      sku: product.sku,
      stockAfter: product.currentStock + quantityDelta,
      stockBefore: product.currentStock,
    });
  }

  // Las RPC recorren los productos `order by product_id` y fallan en el primero.
  missing.sort();

  return { lines, missingProductId: missing[0] ?? null };
}

function missingProductVerdict(productId: string, invoiceNumber: string) {
  return impactRejected(
    "NOT_FOUND",
    `Producto no encontrado en tu tienda (${productId}): no se puede reponer el stock de la venta ${invoiceNumber}`,
  );
}

/** `round(numeric, 2)` de Postgres dentro de un `format('%s')`: siempre dos decimales. */
function sqlMoney(cents: number) {
  return fromCents(cents).toFixed(2);
}

function withoutProjection(stock: ImpactStockLine[]): ImpactStockLine[] {
  return stock.map((line) => ({ ...line, quantityDelta: 0, stockAfter: line.stockBefore }));
}

function assemble(
  inputs: SaleImpactInputs,
  verdict: ImpactVerdict,
  parts: {
    paidCentsAfter: number;
    payments: ImpactPaymentLine[];
    refund: SaleImpact["refund"];
    stock: ImpactStockLine[];
  },
): SaleImpact {
  const { sale } = inputs;
  const stock = verdict.allowed ? parts.stock : withoutProjection(parts.stock);

  return {
    ...verdict,
    action: inputs.action,
    document: {
      contactName: sale.customerName,
      id: sale.id,
      number: sale.invoiceNumber,
      status: sale.status,
      statusAfter: verdict.allowed
        ? inputs.action === "cancel"
          ? "cancelada"
          : "devuelta"
        : sale.status,
    },
    inexact: firstInexact([...parts.payments, ...stock]),
    paidVes: sale.paidVes,
    paidVesAfter: verdict.allowed ? fromCents(parts.paidCentsAfter) : sale.paidVes,
    payments: parts.payments,
    refund: verdict.allowed ? parts.refund : null,
    stock,
  };
}

/**
 * `cancel_sale` no toca dinero: con un solo pago activo rechaza la venta entera
 * y pide anular antes los pagos. Los pagos ya anulados no cambian.
 */
function computeCancel(inputs: SaleImpactInputs): SaleImpact {
  const { sale } = inputs;
  const payments = [...inputs.payments].sort(byCreation);
  const active = payments.filter((payment) => payment.status === "activo");
  let verdict = statusVerdict("cancel", sale.status);

  if (verdict.allowed && active.length > 0) {
    const activeCents = active.reduce((total, payment) => total + toCents(payment.amountVes), 0);

    verdict = impactRejected(
      "CONFLICT",
      `La venta ${sale.invoiceNumber} tiene ${active.length} pago(s) activo(s) por Bs ${sqlMoney(activeCents)}. Anula primero los pagos y luego cancela la venta.`,
    );
  }

  const stock = buildStock(inputs, true);

  if (verdict.allowed && stock.missingProductId) {
    verdict = missingProductVerdict(stock.missingProductId, sale.invoiceNumber);
  }

  const blocked = isLive(sale.status);

  return assemble(inputs, verdict, {
    paidCentsAfter: toCents(sale.paidVes),
    payments: payments.map((payment) =>
      payment.status === "anulado"
        ? cancelledPaymentLine(payment)
        : blocked
          ? staticPaymentLine(
              payment,
              "blocks_action",
              "Sigue activo: hay que anularlo antes de anular la venta.",
            )
          : staticPaymentLine(payment, "unchanged", "No se toca: la venta no se puede anular."),
    ),
    refund: null,
    stock: stock.lines,
  });
}

type VaultState = { cents: number | null };

/** Asientos de caja del pago: `cancel_payment_apply` los borra todos. */
function cashEffects(movements: SaleImpactCashMovement[], hidden: boolean) {
  const effects: ImpactMoneyEffect[] = [];
  let unknownType: string | null = null;

  for (const movement of movements) {
    const kind = CASH_MOVEMENT_KINDS[movement.type];

    if (!kind) {
      unknownType = movement.type;
      continue;
    }

    const note =
      movement.sessionStatus === "closed"
        ? "La caja ya está cerrada y sin transferir al baúl: su cierre guardado no se recalcula."
        : null;
    const amounts = [
      { cents: toCents(movement.amountVes), currency: "VES" as const },
      { cents: toCents(movement.amountRef), currency: "USD" as const },
    ];

    for (const { cents, currency } of amounts) {
      if (cents > 0) {
        effects.push({
          balanceAfter: null,
          balanceBefore: null,
          currency,
          // Borrar el asiento deshace su efecto: signo contrario al del tipo.
          delta: fromCents(-kind.sign * cents),
          note: hidden ? null : note,
          physical: kind.physical,
          ...(hidden ? { restricted: true as const } : {}),
          target: "caja",
          targetName: hidden ? null : movement.registerName,
        });
      }
    }
  }

  return { effects, unknownType };
}

/**
 * Un asiento de baúl (cubeta cuenta) del pago. `cancel_payment_apply` lo busca
 * con `select … into`, así que con más de uno revierte uno cualquiera.
 */
function vaultEffect(
  ledger: FullLedger,
  vault: VaultState,
  paymentId: string,
  type: "sale_in" | "withdrawal",
): { effect: ImpactMoneyEffect | null; inexact: ImpactInexact | null } {
  const movements = ledger.vaultMovements.filter(
    (movement) => movement.paymentId === paymentId && movement.type === type,
  );
  const movement = movements[0];

  if (!movement) {
    return { effect: null, inexact: null };
  }

  if (movements.length > 1) {
    vault.cents = null;

    return {
      effect: null,
      inexact: {
        reason:
          "El pago tiene más de un asiento de baúl del mismo tipo y solo se revierte uno: el saldo resultante no se puede anticipar.",
      },
    };
  }

  const amountCents = toCents(movement.amountVes);
  // `withdrawal` fue el vuelto por cuenta: vuelve al baúl. `sale_in` fue el cobro: sale.
  const signedCents = type === "withdrawal" ? amountCents : -amountCents;

  // Sin `vault.view` el saldo no se leyó: se informa cuánto se mueve, sin saldos.
  // No es una lectura fallida, así que no se declara inexacto.
  if (ledger.hidden?.vault) {
    return {
      effect: {
        balanceAfter: null,
        balanceBefore: null,
        currency: "VES",
        delta: fromCents(signedCents),
        note: null,
        physical: true,
        restricted: true,
        target: "baul_cuenta",
        targetName: null,
      },
      inexact: null,
    };
  }

  if (vault.cents === null || ledger.vault?.id !== movement.vaultId) {
    vault.cents = null;

    return {
      effect: {
        balanceAfter: null,
        balanceBefore: null,
        currency: "VES",
        delta: fromCents(signedCents),
        note: null,
        physical: true,
        target: "baul_cuenta",
        targetName: null,
      },
      inexact: { reason: "No se pudo leer el saldo del baúl: el saldo resultante no se puede anticipar." },
    };
  }

  const before = vault.cents;
  // `greatest(balance_ves - monto, 0)`: el cobro nunca deja la cuenta en negativo.
  const after = Math.max(before + signedCents, 0);
  vault.cents = after;

  return {
    effect: {
      balanceAfter: fromCents(after),
      balanceBefore: fromCents(before),
      currency: "VES",
      delta: fromCents(after - before),
      note:
        after - before !== signedCents
          ? `El saldo en cuenta no cubre ${formatVesBs(fromCents(amountCents))}: queda en ${formatVesBs(0)}.`
          : null,
      physical: true,
      target: "baul_cuenta",
      targetName: null,
    },
    inexact: null,
  };
}

function describeReverted(effects: ImpactMoneyEffect[]) {
  const cash = effects.filter((effect) => effect.target === "caja");
  const registers = [
    ...new Set(
      cash.filter((effect) => !effect.restricted).map((effect) => effect.targetName ?? "sin nombre"),
    ),
  ];
  const parts: string[] = [];

  if (registers.length > 0) {
    parts.push(`se revierte de la caja ${registers.map((name) => `«${name}»`).join(", ")}`);
  } else if (cash.length > 0) {
    // Sin `cash.view` no se nombra la caja.
    parts.push("se revierte de caja");
  }

  if (effects.some((effect) => effect.target === "baul_cuenta")) {
    parts.push("se revierte del baúl (cuenta)");
  }

  return parts.length > 0
    ? `Se anula: ${parts.join(" y ")}.`
    : "Se anula. No tiene asientos de caja ni de baúl: nada que revertir.";
}

/** Suma por método, en la moneda de ese método y en orden de primera aparición. */
function sumByMethod(entries: Array<{ amount: number; amountVes: number; method: PaymentMethod }>) {
  const totals = new Map<PaymentMethod, { amountCents: number; vesCents: number }>();

  for (const entry of entries) {
    const total = totals.get(entry.method) ?? { amountCents: 0, vesCents: 0 };
    total.amountCents += toCents(entry.amount);
    total.vesCents += toCents(entry.amountVes);
    totals.set(entry.method, total);
  }

  return [...totals].map(
    ([method, total]): ImpactMethodAmount => ({
      amount: fromCents(total.amountCents),
      amountVes: fromCents(total.vesCents),
      currency: method === "efectivo_usd" ? "USD" : "VES",
      method,
    }),
  );
}

/**
 * `return_sale`: anula cada pago activo con `cancel_payment_apply` (en orden de
 * creación) y después repone el stock. Si un pago no se puede anular, la
 * devolución entera se rechaza y no se mueve nada.
 */
function computeReturn(inputs: SaleImpactInputs): SaleImpact {
  const { ledger, sale } = inputs;
  const payments = [...inputs.payments].sort(byCreation);
  const active = payments.filter((payment) => payment.status === "activo");
  let verdict = statusVerdict("return", sale.status);
  const live = verdict.allowed;
  const vault: VaultState = {
    cents: ledger.kind === "full" && ledger.vault ? toCents(ledger.vault.balanceVes) : null,
  };
  const reverted = new Map<string, ImpactPaymentLine>();
  let blockingPaymentId: string | null = null;
  let paidCents = toCents(sale.paidVes);

  for (const payment of live ? active : []) {
    const netCents = toCents(payment.amountVes) - toCents(payment.changeVes);

    const cashMovements =
      ledger.kind === "full"
        ? ledger.cashMovements.filter((movement) => movement.paymentId === payment.id)
        : [];

    // F4 — el cierre de esa sesión ya viajó al baúl. Sin asientos no se puede
    // evaluar: es parte de lo que el pago declara inexacto más abajo.
    if (
      cashMovements.some(
        (movement) => movement.sessionStatus === "closed" && movement.vaultTransferredAt !== null,
      )
    ) {
      verdict = impactRejected("CONFLICT", MESSAGES.closureTransferred);
      blockingPaymentId = payment.id;
      break;
    }

    if (paidCents < netCents) {
      verdict = impactRejected("BAD_REQUEST", MESSAGES.paymentExceedsSale);
      blockingPaymentId = payment.id;
      break;
    }

    paidCents -= netCents;

    if (ledger.kind === "unavailable") {
      reverted.set(payment.id, {
        ...basePaymentLine(payment),
        description: "Se anula con la devolución.",
        effects: [],
        inexact: { reason: ledger.reason },
        outcome: "reverted",
        statusAfter: "anulado",
      });
      continue;
    }

    const effects: ImpactMoneyEffect[] = [];
    let inexact: ImpactInexact | null = null;

    // 1. Vuelto entregado por cuenta: vuelve al baúl.
    if (
      toCents(payment.changeVes) > 0 &&
      payment.changeMethod !== null &&
      BANK_METHODS.includes(payment.changeMethod)
    ) {
      const change = vaultEffect(ledger, vault, payment.id, "withdrawal");
      if (change.effect) effects.push(change.effect);
      inexact = inexact ?? change.inexact;
    }

    // 2. Asientos de caja del pago (cobro y vuelto): se borran.
    const cash = cashEffects(cashMovements, ledger.hidden?.cash === true);
    effects.push(...cash.effects);
    if (cash.unknownType) {
      inexact = inexact ?? {
        reason: `El pago tiene un asiento de caja de tipo «${cash.unknownType}» cuyo efecto no se puede anticipar.`,
      };
    }

    // 3. Cobro por cuenta: sale del baúl.
    if (BANK_METHODS.includes(payment.method)) {
      const collected = vaultEffect(ledger, vault, payment.id, "sale_in");
      if (collected.effect) effects.push(collected.effect);
      inexact = inexact ?? collected.inexact;
    }

    reverted.set(payment.id, {
      ...basePaymentLine(payment),
      description: describeReverted(effects),
      effects,
      inexact,
      outcome: "reverted",
      statusAfter: "anulado",
    });
  }

  const stock = buildStock(inputs, true);

  if (verdict.allowed && stock.missingProductId) {
    verdict = missingProductVerdict(stock.missingProductId, sale.invoiceNumber);
  }

  const allowed = verdict.allowed;

  return assemble(inputs, verdict, {
    paidCentsAfter: paidCents,
    payments: payments.map((payment) => {
      if (payment.status === "anulado") {
        return cancelledPaymentLine(payment);
      }

      if (payment.id === blockingPaymentId) {
        return staticPaymentLine(
          payment,
          "blocks_action",
          "No se puede anular: por este pago la devolución se rechaza.",
        );
      }

      const line = reverted.get(payment.id);

      return allowed && line
        ? line
        : staticPaymentLine(payment, "unchanged", "No se toca: la venta no se puede devolver.");
    }),
    refund: {
      byMethod: sumByMethod(active),
      changeToRecover: sumByMethod(
        active.flatMap((payment) =>
          payment.changeMethod !== null && toCents(payment.changeVes) > 0
            ? [
                {
                  amount:
                    payment.changeMethod === "efectivo_usd" ? payment.changeRef : payment.changeVes,
                  amountVes: payment.changeVes,
                  method: payment.changeMethod,
                },
              ]
            : [],
        ),
      ),
      netVes: fromCents(toCents(sale.paidVes) - paidCents),
    },
    stock: stock.lines,
  });
}

export function computeSaleImpact(inputs: SaleImpactInputs): SaleImpact {
  return inputs.action === "cancel" ? computeCancel(inputs) : computeReturn(inputs);
}
