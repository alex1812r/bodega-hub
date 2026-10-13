"use client";

import { type ComponentProps, useState } from "react";

import { getProductMarginThresholds } from "@/modules/products/services/productMargin";
import { usePricingSettings } from "@/modules/settings/hooks/useSettings";
import type { ConfirmActionStatus } from "@/shared/components/ConfirmActionModal";

import { usePurchaseImpact } from "../../hooks/usePurchaseImpact";
import type { PurchaseImpact } from "../../services/purchaseImpact";
import type { ReceiveDisassembleEntry } from "../../services/purchaseDisassemble";
import { PurchaseReceivePreviewModal } from "./PurchaseReceivePreviewModal";

type PurchaseReceiveConfirmModalProps = Omit<
  ComponentProps<typeof PurchaseReceivePreviewModal>,
  "effect" | "open" | "thresholds"
> & {
  /**
   * La lista `disassemble` que se enviará en `PATCH /receive`
   * (`buildReceiveDisassembleRequest`); `undefined` = no viaja lista. El efecto
   * se pide para ESA lista y se vuelve a pedir cada vez que cambia.
   */
  disassemble?: readonly ReceiveDisassembleEntry[];
  purchaseId: string;
};

/**
 * La confirmación de recepción con su efecto real (CNF-04): pide el impact de
 * `receive` con la lista de desarme que el modal va a enviar y los cortes de
 * ganancia de la tienda, y se los pasa a `PurchaseReceivePreviewModal`.
 *
 * Se monta solo mientras el modal está abierto: cada apertura calcula el efecto
 * de nuevo. Al cambiar marcas o reparto sigue a la vista el efecto anterior,
 * atenuado y sin poder confirmar, hasta que llega el de la lista nueva.
 */
export function PurchaseReceiveConfirmModal({
  disassemble,
  purchaseId,
  ...props
}: PurchaseReceiveConfirmModalProps) {
  const query = usePurchaseImpact({ action: "receive", disassemble, enabled: true, purchaseId });
  const pricing = usePricingSettings();
  // Efecto de la lista actual; mientras se pide (o si falló) no hay ninguno vigente.
  const current = query.isSuccess && !query.isFetching ? (query.data ?? null) : null;
  const [previous, setPrevious] = useState<PurchaseImpact | null>(null);

  if (current) {
    if (current !== previous) {
      setPrevious(current);
    }
  } else if (!query.isFetching && previous) {
    // El cálculo falló: el efecto anterior ya no describe lo que se enviaría.
    setPrevious(null);
  }

  const impact = current ?? (query.isFetching ? previous : null);
  let status: ConfirmActionStatus = "loading";

  if (impact) {
    status = impact.allowed ? "ready" : "blocked";
  } else if (!query.isFetching) {
    status = "error";
  }

  return (
    <PurchaseReceivePreviewModal
      {...props}
      effect={{
        impact,
        message: query.error instanceof Error ? query.error.message : null,
        onRetry: () => void query.refetch(),
        recalculating: !current && impact !== null,
        status,
      }}
      open
      thresholds={getProductMarginThresholds(pricing.data)}
    />
  );
}
