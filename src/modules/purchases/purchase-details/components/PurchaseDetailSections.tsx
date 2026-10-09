"use client";

import { useState } from "react";

import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { formatRefUsd } from "@/shared/utils/currency";

import type { PurchaseDetails } from "../../hooks/usePurchases";
import { getPurchaseInfoBanner } from "../utils/purchaseDetailLabels";
import { formatPurchaseCreatedLabel, PurchaseDetailDatesCard } from "./PurchaseDetailDatesCard";
import { PurchaseDetailInfoBanner } from "./PurchaseDetailInfoBanner";
import { PurchaseDetailPaymentsTable } from "./PurchaseDetailPaymentsTable";
import { PurchaseDetailProductsTable } from "./PurchaseDetailProductsTable";
import { PurchaseDetailSupplierCard } from "./PurchaseDetailSupplierCard";

/** Claves de `localStorage` que recuerdan cada sección abierta o cerrada. */
export const PURCHASE_DETAIL_SECTION_STORAGE_KEYS = {
  dates: "purchase-detail:dates-open",
  info: "purchase-detail:info-open",
  payments: "purchase-detail:payments-open",
  products: "purchase-detail:products-open",
  supplier: "purchase-detail:supplier-open",
} as const;

type PurchaseDetailSectionsProps = {
  /**
   * Si el rol puede ver los pagos de compras. `undefined` mientras el perfil no
   * cargó: aún no se sabe cuál de los dos historiales toca y no se pinta ninguno.
   */
  canViewPayments?: boolean;
  /** URL actual del detalle, con su `returnTo`: a ella vuelven los enlaces salientes. */
  detailUrl: string;
  paidRef: number;
  pendingRef: number;
  purchase: PurchaseDetails;
};

/** Resumen de «Pagos» cerrada. `count` es `null` si el rol no ve los pagos (llegan vacíos). */
function paymentsSummary(count: number | null, paidRef: number) {
  if (count === null) {
    return `Pagado ${formatRefUsd(paidRef)}`;
  }

  return `${count} ${count === 1 ? "pago" : "pagos"} · pagado ${formatRefUsd(paidRef)}`;
}

/** Productos, pagos, proveedor, fechas e información de la compra, en secciones plegables. */
export function PurchaseDetailSections({
  canViewPayments,
  detailUrl,
  paidRef,
  pendingRef,
  purchase,
}: PurchaseDetailSectionsProps) {
  // Se decide al entrar: saldar la compra con «Pagar» no pliega el historial que
  // se está mirando. Lo que el usuario abra o cierre manda después (`storageKey`).
  const [paymentsOpenByDefault] = useState(pendingRef >= 0.01);
  const notes = purchase.notes?.trim() ?? "";
  const info = getPurchaseInfoBanner(purchase.status, {
    createdAt: purchase.createdAt,
    notes: purchase.notes,
    updatedAt: purchase.updatedAt,
  });
  const isClosed = purchase.status === "cancelado" || purchase.status === "devuelto";
  const itemCount = purchase.items.length;

  return (
    <div className="space-y-4">
      <CollapsibleSection
        defaultOpen
        storageKey={PURCHASE_DETAIL_SECTION_STORAGE_KEYS.products}
        summary={`${itemCount} ${itemCount === 1 ? "producto" : "productos"}`}
        title="Productos"
      >
        <PurchaseDetailProductsTable
          discountRef={purchase.discountRef}
          discountVes={purchase.discountVes ?? 0}
          items={purchase.items}
          status={purchase.status}
          taxRef={purchase.taxRef}
          taxVes={purchase.taxVes ?? 0}
          totalRef={purchase.totalRef}
          totalVes={purchase.totalVes}
        />
      </CollapsibleSection>

      <CollapsibleSection
        defaultOpen={paymentsOpenByDefault}
        storageKey={PURCHASE_DETAIL_SECTION_STORAGE_KEYS.payments}
        summary={paymentsSummary(canViewPayments ? purchase.payments.length : null, paidRef)}
        title="Pagos"
      >
        {canViewPayments === undefined ? null : (
          <PurchaseDetailPaymentsTable
            canViewPayments={canViewPayments}
            payments={purchase.payments}
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        storageKey={PURCHASE_DETAIL_SECTION_STORAGE_KEYS.supplier}
        summary={purchase.supplier?.name ?? purchase.supplierId}
        title="Proveedor"
      >
        <PurchaseDetailSupplierCard
          detailUrl={detailUrl}
          supplier={purchase.supplier}
          supplierId={purchase.supplierId}
        />
      </CollapsibleSection>

      <CollapsibleSection
        storageKey={PURCHASE_DETAIL_SECTION_STORAGE_KEYS.dates}
        summary={`Creada el ${formatPurchaseCreatedLabel(purchase.createdAt)}`}
        title="Fechas"
      >
        <PurchaseDetailDatesCard createdAt={purchase.createdAt} />
      </CollapsibleSection>

      <CollapsibleSection
        storageKey={PURCHASE_DETAIL_SECTION_STORAGE_KEYS.info}
        summary={notes || info.title}
        title="Notas e información"
      >
        <div className="space-y-3">
          <PurchaseDetailInfoBanner
            createdAt={purchase.createdAt}
            notes={purchase.notes}
            status={purchase.status}
            updatedAt={purchase.updatedAt}
          />
          {/* El aviso de una compra cancelada o devuelta no cita las notas: van aparte. */}
          {isClosed && notes ? (
            <p className="text-sm text-on-surface-variant [overflow-wrap:anywhere]">
              Observaciones: {notes}
            </p>
          ) : null}
        </div>
      </CollapsibleSection>
    </div>
  );
}
