import type { ImpactInexact, ImpactRejectionCode, ImpactVerdict } from "./types";

export function impactAllowed(): ImpactVerdict {
  return { allowed: true, reason: null, reasonCode: null };
}

/** La RPC rechazaría la acción con ese mensaje y ese código. */
export function impactRejected(reasonCode: ImpactRejectionCode, reason: string): ImpactVerdict {
  return { allowed: false, reason, reasonCode };
}

/** Primera parte inexacta de una lista (o `null`): resumen para la cabecera del impact. */
export function firstInexact(
  parts: ReadonlyArray<{ inexact: ImpactInexact | null }>,
): ImpactInexact | null {
  return parts.find((part) => part.inexact)?.inexact ?? null;
}

/** Dinero en céntimos enteros: las sumas de un impact no se hacen en coma flotante. */
export function toCents(value: number) {
  return Math.round(value * 100);
}

export function fromCents(cents: number) {
  return cents / 100;
}
