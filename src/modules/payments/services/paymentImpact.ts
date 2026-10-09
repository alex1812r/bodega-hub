/**
 * Efecto de anular un pago (`cancel_payment` → `cancel_payment_apply`),
 * calculado SIN escribir (CNF-14). Función pura: el cargador real
 * (`paymentImpact.server.ts`) y el del mock (`paymentImpact.mock-server.ts`)
 * solo leen y le pasan los datos; el cálculo es el mismo en los dos.
 *
 * Reproduce, paso a paso y en su mismo orden, las versiones vigentes de
 * `cancel_payment` (20261006b) y `cancel_payment_apply` (20261006h) para las dos
 * clases de pago que existen: cobro de venta y pago a proveedor de compra.
 * Detalle y citas: `.notes/ux-mejoras/confirmaciones/CNF-14-diseno.md`, sección "Pago".
 *
 * La reversión de caja y baúl de un cobro de venta es la misma que modela
 * `src/modules/sales/services/saleImpact.ts` (que no la exporta): aquí va
 * duplicada lo mínimo, pendiente de unificar en un módulo común.
 */
import {
  fromCents,
  impactAllowed,
  impactRejected,
  toCents,
} from "@/shared/impact/impactVerdict";
import type {
  ImpactDocument,
  ImpactInexact,
  ImpactMoneyEffect,
  ImpactMoneyTarget,
  ImpactVerdict,
} from "@/shared/impact/types";
import type {
  PaymentMethod,
  PaymentStatus,
  PurchaseStatus,
  SaleStatus,
} from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

export const PAYMENT_IMPACT_ACTIONS = ["cancel"] as const;

export type PaymentImpactAction = (typeof PAYMENT_IMPACT_ACTIONS)[number];

export type PaymentImpactCashMovement = {
  amountRef: number;
  amountVes: number;
  registerName: string | null;
  sessionStatus: "closed" | "open";
  type: string;
  /** `cash_sessions.vault_transferred_at`: el cierre de esa sesión ya viajó al baúl. */
  vaultTransferredAt: string | null;
};

export type PaymentImpactVaultMovement = {
  amountRef: number;
  amountVes: number;
  id: string;
  type: string;
  vaultId: string;
};

/**
 * Asientos de caja y baúl del pago. `unavailable`: la fuente no los tiene (modo
 * demo); el efecto sobre el dinero sale entonces como `inexact`.
 */
export type PaymentImpactLedger =
  | {
      cashMovements: PaymentImpactCashMovement[];
      kind: "full";
      /** Baúl de la tienda (`store_vaults`) con sus tres cubetas. */
      vault: {
        balanceEfectivoVes: number;
        balanceRef: number;
        balanceVes: number;
        id: string;
      } | null;
      vaultMovements: PaymentImpactVaultMovement[];
    }
  | { kind: "unavailable"; reason: string };

export type PaymentImpactInputs = {
  action: PaymentImpactAction;
  /** `cancel_payment` solo deja anular a admin y contador (PT403). */
  canCancelPayments: boolean;
  document:
    | {
        contactName: string | null;
        id: string;
        kind: "sale";
        number: string;
        paidVes: number;
        status: SaleStatus;
        totalVes: number;
      }
    | {
        contactName: string | null;
        id: string;
        kind: "purchase";
        number: string;
        paidRef: number;
        paidVes: number;
        status: PurchaseStatus;
        totalRef: number;
        totalVes: number;
      };
  ledger: PaymentImpactLedger;
  payment: {
    amount: number;
    amountRef: number;
    amountVes: number;
    changeMethod: PaymentMethod | null;
    changeRef: number;
    changeVes: number;
    currency: "USD" | "VES";
    id: string;
    method: PaymentMethod;
    status: PaymentStatus;
  };
};

/**
 * Documento del pago con su saldo antes → después. Las ventas llevan el cobrado
 * solo en Bs (`paid_ves`): sus campos REF van en `null`. Las compras llevan Bs
 * y REF. `cancel_payment_apply` no cambia el estado de una compra.
 */
export type PaymentImpactDocument = ImpactDocument<PurchaseStatus | SaleStatus> & {
  kind: "purchase" | "sale";
  paidRef: number | null;
  paidRefAfter: number | null;
  paidVes: number;
  paidVesAfter: number;
  /** Saldo pendiente: `max(total − pagado, 0)`, como lo muestra el detalle del pago. */
  pendingRef: number | null;
  pendingRefAfter: number | null;
  pendingVes: number;
  pendingVesAfter: number;
  totalRef: number | null;
  totalVes: number;
};

/** Respuesta de `GET /api/payments/[id]/impact?action=cancel`. */
export type PaymentImpact = ImpactVerdict & {
  action: PaymentImpactAction;
  /** Frase en español, lista para mostrar, con lo que pasa con el dinero. */
  description: string;
  document: PaymentImpactDocument;
  /** Asientos de caja y de baúl que la anulación revierte, en el orden de la RPC. */
  effects: ImpactMoneyEffect[];
  /** Parte del efecto sobre el dinero que no se pudo calcular con exactitud. */
  inexact: ImpactInexact | null;
  payment: {
    /** Monto en la moneda del pago (`currency`). */
    amount: number;
    amountRef: number;
    amountVes: number;
    changeMethod: PaymentMethod | null;
    changeRef: number;
    /** Vuelto entregado en ese cobro, en Bs. */
    changeVes: number;
    currency: "USD" | "VES";
    /** `entrada`: cobro de venta. `salida`: pago a proveedor. */
    direction: "entrada" | "salida";
    id: string;
    method: PaymentMethod;
    /** Lo que el pago aportó al documento en Bs: `amountVes − changeVes`. */
    netVes: number;
    status: PaymentStatus;
    statusAfter: PaymentStatus;
  };
};

const BANK_METHODS: readonly PaymentMethod[] = ["pago_movil", "transferencia", "punto_venta"];
const CASH_METHODS: readonly PaymentMethod[] = ["efectivo_ves", "efectivo_usd"];

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
  alreadyCancelled: "El pago ya fue anulado",
  closureTransferred:
    "No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo",
  forbidden: "No autorizado para anular pagos",
  paymentExceedsPurchase: "El monto del pago excede lo registrado en la compra",
  paymentExceedsSale: "El monto del pago excede lo registrado en la venta",
  paymentRefExceedsPurchase: "El monto REF del pago excede lo registrado en la compra",
  purchaseClosed: "No se puede anular un pago de una compra cancelada o devuelta",
  saleClosed: "No se puede anular un pago de una venta cancelada o devuelta",
} as const;

type FullLedger = Extract<PaymentImpactLedger, { kind: "full" }>;
type VaultTarget = Exclude<ImpactMoneyTarget, "caja">;
/** Saldo de cada cubeta en céntimos mientras se encadenan asientos; `null` = ilegible. */
type VaultState = Record<VaultTarget, number | null>;
type MoneyPart = { effects: ImpactMoneyEffect[]; inexact: ImpactInexact | null };

const VAULT_LABELS: Record<VaultTarget, string> = {
  baul_cuenta: "baúl (cuenta)",
  baul_efectivo_ves: "baúl (efectivo Bs)",
  baul_ref: "baúl (efectivo REF)",
};

function formatMoney(value: number, currency: "USD" | "VES") {
  return currency === "USD" ? formatRefUsd(value) : formatVesBs(value);
}

/** Guardas de `cancel_payment` y `cancel_payment_apply`, en su orden. */
function verdictOf(inputs: PaymentImpactInputs, netCents: number): ImpactVerdict {
  const { document, ledger, payment } = inputs;

  if (!inputs.canCancelPayments) {
    return impactRejected("FORBIDDEN", MESSAGES.forbidden);
  }

  if (payment.status === "anulado") {
    return impactRejected("CONFLICT", MESSAGES.alreadyCancelled);
  }

  // F4 — el cierre de la sesión de ese asiento ya viajó al baúl. Sin asientos
  // (modo demo) no se puede evaluar: queda cubierto por el `inexact` del efecto.
  if (
    ledger.kind === "full" &&
    ledger.cashMovements.some(
      (movement) => movement.sessionStatus === "closed" && movement.vaultTransferredAt !== null,
    )
  ) {
    return impactRejected("CONFLICT", MESSAGES.closureTransferred);
  }

  if (document.kind === "sale") {
    if (document.status === "cancelada" || document.status === "devuelta") {
      return impactRejected("CONFLICT", MESSAGES.saleClosed);
    }

    if (toCents(document.paidVes) < netCents) {
      return impactRejected("BAD_REQUEST", MESSAGES.paymentExceedsSale);
    }

    return impactAllowed();
  }

  if (document.status === "cancelado" || document.status === "devuelto") {
    return impactRejected("CONFLICT", MESSAGES.purchaseClosed);
  }

  // A la compra se le resta el bruto: un pago a proveedor no lleva vuelto.
  if (toCents(document.paidVes) < toCents(payment.amountVes)) {
    return impactRejected("BAD_REQUEST", MESSAGES.paymentExceedsPurchase);
  }

  if (toCents(document.paidRef) < toCents(payment.amountRef)) {
    return impactRejected("BAD_REQUEST", MESSAGES.paymentRefExceedsPurchase);
  }

  return impactAllowed();
}

/** Asientos de caja del cobro: `cancel_payment_apply` los borra todos. */
function cashPart(movements: PaymentImpactCashMovement[]): MoneyPart {
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
          note,
          physical: kind.physical,
          target: "caja",
          targetName: movement.registerName,
        });
      }
    }
  }

  return {
    effects,
    inexact: unknownType
      ? {
          reason: `El pago tiene un asiento de caja de tipo «${unknownType}» cuyo efecto no se puede anticipar.`,
        }
      : null,
  };
}

/**
 * Efecto de un asiento de baúl sobre una cubeta. `clampAtZero` reproduce el
 * `greatest(balance − monto, 0)` de la reversión de un cobro por cuenta (D22):
 * se informa el saldo que la RPC dejará de verdad, no el ideal.
 */
function bucketEffect(
  ledger: FullLedger,
  state: VaultState,
  movement: PaymentImpactVaultMovement,
  target: VaultTarget,
  signedCents: number,
  clampAtZero: boolean,
): MoneyPart {
  const currency = target === "baul_ref" ? ("USD" as const) : ("VES" as const);
  const before = state[target];

  if (before === null || ledger.vault?.id !== movement.vaultId) {
    state[target] = null;

    return {
      effects: [
        {
          balanceAfter: null,
          balanceBefore: null,
          currency,
          delta: fromCents(signedCents),
          note: null,
          physical: true,
          target,
          targetName: null,
        },
      ],
      inexact: {
        reason: "No se pudo leer el saldo del baúl: el saldo resultante no se puede anticipar.",
      },
    };
  }

  const after = clampAtZero ? Math.max(before + signedCents, 0) : before + signedCents;
  const shortfall = after - before - signedCents;
  state[target] = after;

  return {
    effects: [
      {
        balanceAfter: fromCents(after),
        balanceBefore: fromCents(before),
        currency,
        delta: fromCents(after - before),
        note:
          shortfall !== 0
            ? `El ${VAULT_LABELS[target]} solo tiene ${formatMoney(fromCents(before), currency)} y el cobro fue de ${formatMoney(fromCents(-signedCents), currency)}: quedará en ${formatMoney(0, currency)}, recortado en ${formatMoney(fromCents(shortfall), currency)}, y dejará de cuadrar con sus movimientos.`
            : null,
        physical: true,
        target,
        targetName: null,
      },
    ],
    inexact: null,
  };
}

/**
 * Asientos de baúl de un tipo. `cancel_payment_apply` busca el suyo con
 * `select … into`: con más de uno revierte uno cualquiera y deja el resto.
 */
function vaultPart(
  ledger: FullLedger,
  state: VaultState,
  type: "purchase_out" | "sale_in" | "withdrawal",
  apply: (movement: PaymentImpactVaultMovement) => MoneyPart[],
): MoneyPart {
  const movements = ledger.vaultMovements.filter((movement) => movement.type === type);
  const movement = movements[0];

  if (!movement) {
    return { effects: [], inexact: null };
  }

  if (movements.length > 1) {
    state.baul_cuenta = null;
    state.baul_efectivo_ves = null;
    state.baul_ref = null;

    return {
      effects: [],
      inexact: {
        reason:
          "El pago tiene más de un asiento de baúl del mismo tipo y solo se revierte uno: el saldo resultante no se puede anticipar.",
      },
    };
  }

  return mergeParts(apply(movement));
}

function mergeParts(parts: MoneyPart[]): MoneyPart {
  return {
    effects: parts.flatMap((part) => part.effects),
    inexact: parts.find((part) => part.inexact)?.inexact ?? null,
  };
}

/** Cobro de venta: vuelto por cuenta → asientos de caja → cobro por cuenta. */
function saleMoney(inputs: PaymentImpactInputs, ledger: FullLedger, state: VaultState) {
  const { payment } = inputs;
  const parts: MoneyPart[] = [];

  // 1. Vuelto entregado por cuenta: su `withdrawal` vuelve al baúl (cuenta).
  if (
    toCents(payment.changeVes) > 0 &&
    payment.changeMethod !== null &&
    BANK_METHODS.includes(payment.changeMethod)
  ) {
    parts.push(
      vaultPart(ledger, state, "withdrawal", (movement) => [
        bucketEffect(ledger, state, movement, "baul_cuenta", toCents(movement.amountVes), false),
      ]),
    );
  }

  // 2. Asientos de caja del pago (cobro y vuelto): se borran, esté la sesión
  //    abierta o cerrada sin transferir.
  if (CASH_METHODS.includes(payment.method) || BANK_METHODS.includes(payment.method)) {
    parts.push(cashPart(ledger.cashMovements));
  }

  // 3. Cobro por cuenta: su `sale_in` sale del baúl (cuenta), sin bajar de 0.
  if (BANK_METHODS.includes(payment.method)) {
    parts.push(
      vaultPart(ledger, state, "sale_in", (movement) => [
        bucketEffect(ledger, state, movement, "baul_cuenta", -toCents(movement.amountVes), true),
      ]),
    );
  }

  return mergeParts(parts);
}

/** Pago a proveedor: su `purchase_out` vuelve a la cubeta de la que salió. No toca caja. */
function purchaseMoney(inputs: PaymentImpactInputs, ledger: FullLedger, state: VaultState) {
  const { payment } = inputs;

  if (CASH_METHODS.includes(payment.method)) {
    return vaultPart(ledger, state, "purchase_out", (movement) => {
      const vesCents = toCents(movement.amountVes);
      const refCents = toCents(movement.amountRef);

      return [
        ...(vesCents !== 0
          ? [bucketEffect(ledger, state, movement, "baul_efectivo_ves", vesCents, false)]
          : []),
        ...(refCents !== 0
          ? [bucketEffect(ledger, state, movement, "baul_ref", refCents, false)]
          : []),
      ];
    });
  }

  if (BANK_METHODS.includes(payment.method)) {
    return vaultPart(ledger, state, "purchase_out", (movement) => [
      bucketEffect(ledger, state, movement, "baul_cuenta", toCents(movement.amountVes), false),
    ]);
  }

  return { effects: [], inexact: null };
}

function describeEffect(effect: ImpactMoneyEffect) {
  const amount = formatMoney(Math.abs(effect.delta), effect.currency);

  if (effect.target === "caja") {
    const register = `la caja «${effect.targetName ?? "sin nombre"}»`;

    if (!effect.physical) {
      return effect.delta < 0
        ? `se quita el cobro por cuenta de ${amount} del turno de ${register}`
        : `se quita el vuelto por cuenta de ${amount} del turno de ${register}`;
    }

    return effect.delta < 0
      ? `salen ${amount} de ${register}`
      : `vuelven ${amount} a ${register} (el vuelto entregado)`;
  }

  const vault = VAULT_LABELS[effect.target];

  if (effect.delta === 0) {
    return `el ${vault} no cambia: ya estaba en ${formatMoney(0, effect.currency)}`;
  }

  return effect.delta > 0 ? `vuelven ${amount} al ${vault}` : `salen ${amount} del ${vault}`;
}

function describe(
  inputs: PaymentImpactInputs,
  verdict: ImpactVerdict,
  money: MoneyPart,
): string {
  const subject = inputs.document.kind === "sale" ? "el cobro" : "el pago al proveedor";

  if (!verdict.allowed) {
    return inputs.payment.status === "anulado"
      ? "Ya estaba anulado: nada que revertir."
      : `No se puede anular ${subject}: no cambia nada.`;
  }

  if (inputs.ledger.kind === "unavailable") {
    return `Se anula ${subject}.`;
  }

  if (money.effects.length === 0) {
    return money.inexact
      ? `Se anula ${subject}.`
      : `Se anula ${subject}. No tiene asientos de caja ni de baúl: no se mueve dinero.`;
  }

  return `Se anula ${subject}: ${money.effects.map(describeEffect).join("; ")}.`;
}

function pending(totalCents: number, paidCents: number) {
  return fromCents(Math.max(totalCents - paidCents, 0));
}

function buildDocument(
  inputs: PaymentImpactInputs,
  allowed: boolean,
  netCents: number,
): PaymentImpactDocument {
  const { document, payment } = inputs;
  const totalVesCents = toCents(document.totalVes);
  const paidVesCents = toCents(document.paidVes);
  const header = {
    contactName: document.contactName,
    id: document.id,
    number: document.number,
    paidVes: document.paidVes,
    pendingVes: pending(totalVesCents, paidVesCents),
    totalVes: document.totalVes,
  };

  if (document.kind === "sale") {
    const paidAfterCents = allowed ? paidVesCents - netCents : paidVesCents;

    return {
      ...header,
      kind: "sale",
      paidRef: null,
      paidRefAfter: null,
      paidVesAfter: fromCents(paidAfterCents),
      pendingRef: null,
      pendingRefAfter: null,
      pendingVesAfter: pending(totalVesCents, paidAfterCents),
      status: document.status,
      // Un borrador conserva su estado; el resto se recalcula contra el total.
      statusAfter:
        !allowed || document.status === "borrador"
          ? document.status
          : paidAfterCents >= totalVesCents
            ? "pagada"
            : "pendiente_pago",
      totalRef: null,
    };
  }

  const totalRefCents = toCents(document.totalRef);
  const paidRefCents = toCents(document.paidRef);
  const paidAfterCents = allowed ? paidVesCents - toCents(payment.amountVes) : paidVesCents;
  const paidRefAfterCents = allowed
    ? Math.max(paidRefCents - toCents(payment.amountRef), 0)
    : paidRefCents;

  return {
    ...header,
    kind: "purchase",
    paidRef: document.paidRef,
    paidRefAfter: fromCents(paidRefAfterCents),
    paidVesAfter: fromCents(paidAfterCents),
    pendingRef: pending(totalRefCents, paidRefCents),
    pendingRefAfter: pending(totalRefCents, paidRefAfterCents),
    pendingVesAfter: pending(totalVesCents, paidAfterCents),
    status: document.status,
    statusAfter: document.status,
    totalRef: document.totalRef,
  };
}

export function computePaymentImpact(inputs: PaymentImpactInputs): PaymentImpact {
  const { document, ledger, payment } = inputs;
  // A la venta se le aplicó el neto (monto − vuelto), así que se le devuelve el neto.
  const netCents = toCents(payment.amountVes) - toCents(payment.changeVes);
  const verdict = verdictOf(inputs, netCents);
  let money: MoneyPart = { effects: [], inexact: null };

  if (verdict.allowed) {
    if (ledger.kind === "unavailable") {
      money = { effects: [], inexact: { reason: ledger.reason } };
    } else {
      const state: VaultState = {
        baul_cuenta: ledger.vault ? toCents(ledger.vault.balanceVes) : null,
        baul_efectivo_ves: ledger.vault ? toCents(ledger.vault.balanceEfectivoVes) : null,
        baul_ref: ledger.vault ? toCents(ledger.vault.balanceRef) : null,
      };

      money =
        document.kind === "sale"
          ? saleMoney(inputs, ledger, state)
          : purchaseMoney(inputs, ledger, state);
    }
  }

  return {
    ...verdict,
    action: inputs.action,
    description: describe(inputs, verdict, money),
    document: buildDocument(inputs, verdict.allowed, netCents),
    effects: money.effects,
    inexact: money.inexact,
    payment: {
      amount: payment.amount,
      amountRef: payment.amountRef,
      amountVes: payment.amountVes,
      changeMethod: payment.changeMethod,
      changeRef: payment.changeRef,
      changeVes: payment.changeVes,
      currency: payment.currency,
      direction: document.kind === "sale" ? "entrada" : "salida",
      id: payment.id,
      method: payment.method,
      netVes: fromCents(netCents),
      status: payment.status,
      statusAfter: verdict.allowed ? "anulado" : payment.status,
    },
  };
}
