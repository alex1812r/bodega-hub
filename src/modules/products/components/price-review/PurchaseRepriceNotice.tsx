"use client";

import { TrendingDown } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { usePricingSettings } from "@/modules/settings/hooks/useSettings";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { formatMarkupPct, MarginBadge } from "@/shared/components/MarginBadge";
import { useToast } from "@/shared/components/Toast";
import { roundMoney } from "@/shared/utils/currency";
import { priceFromMarkup, type MarginThresholds } from "@/shared/utils/pricing";

import {
  useKeepProductPrice,
  usePriceReview,
  type ProductPriceReviewItem,
} from "../../hooks/usePriceReview";
import { useUpdateProductPrice } from "../../hooks/useProducts";
import { buildRepriceReason } from "../../services/priceReview";
import { getProductMarginThresholds } from "../../services/productMargin";

/** Filas visibles antes de "Mostrar N más". */
export const PURCHASE_REPRICE_VISIBLE_ROWS = 10;

const PRODUCTS_REVIEW_HREF = "/products?review=1";

/** Monto REF en formato español, sin unidad: "11,25". */
function formatRefAmount(value: number) {
  return roundMoney(value).toLocaleString("es-VE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

/**
 * Reprecio que se propone para un producto de la cola: el % de ganancia que
 * tenía antes de la compra (a dos decimales, como lo muestra el semáforo)
 * aplicado sobre el costo actual. El costo ya incluye el IVA (regla 10).
 */
export function getPurchaseRepriceProposal(
  item: Pick<ProductPriceReviewItem, "currentCostRef" | "previousMarginPct">,
) {
  const markupPct = Math.round(item.previousMarginPct * 100) / 100;

  return { markupPct, salePriceRef: priceFromMarkup(item.currentCostRef, markupPct) };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type PurchaseRepriceRowProps = {
  canManage: boolean;
  item: ProductPriceReviewItem;
  thresholds: MarginThresholds;
};

function PurchaseRepriceRow({ canManage, item, thresholds }: PurchaseRepriceRowProps) {
  const updatePrice = useUpdateProductPrice(item.productId);
  const keepPrice = useKeepProductPrice();
  const { showToast } = useToast();
  // Candado de la fila: bloquea un segundo envío en el mismo tick y, tras el
  // éxito, hasta que el refresco de la cola la retira.
  const lockedRef = useRef(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proposal = getPurchaseRepriceProposal(item);
  const purchaseNumber = item.purchase?.number.trim() ?? "";
  const currentPrice = formatRefAmount(item.salePriceRef);
  const proposedPrice = formatRefAmount(proposal.salePriceRef);

  function lock() {
    if (lockedRef.current) {
      return false;
    }

    lockedRef.current = true;
    setIsLocked(true);
    setError(null);

    return true;
  }

  function unlock(message: string) {
    lockedRef.current = false;
    setIsLocked(false);
    setError(message);
  }

  async function handleApply() {
    if (!lock()) {
      return;
    }

    try {
      await updatePrice.mutateAsync({
        reason: `${buildRepriceReason(proposal.markupPct)}${purchaseNumber ? ` por compra ${purchaseNumber}` : ""}`,
        salePriceRef: proposal.salePriceRef,
      });
      setIsConfirmOpen(false);
      showToast({
        description: `Pasa de ${currentPrice} a ${proposedPrice} REF.`,
        title: `Precio actualizado: ${item.name}`,
        tone: "success",
      });
    } catch (applyError) {
      unlock(errorMessage(applyError, "No se pudo cambiar el precio."));
    }
  }

  async function handleKeep() {
    if (!lock()) {
      return;
    }

    try {
      await keepPrice.mutateAsync({
        productId: item.productId,
        reason: purchaseNumber ? `Precio mantenido tras compra ${purchaseNumber}` : undefined,
      });
      showToast({
        description: `Sigue en ${currentPrice} REF.`,
        title: `Precio mantenido: ${item.name}`,
        tone: "success",
      });
    } catch (keepError) {
      unlock(errorMessage(keepError, "No se pudo mantener el precio."));
    }
  }

  return (
    <li
      className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`purchase-reprice-row-${item.productId}`}
    >
      <div className="min-w-0 space-y-1">
        <p className="min-w-0 break-words text-sm">
          <Link
            className="font-semibold text-foreground underline-offset-2 hover:underline"
            href={`/products/${item.productId}`}
          >
            {item.name}
          </Link>{" "}
          <span className="text-on-surface-variant">{item.sku}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm tabular-nums text-on-surface-variant">
          <span>
            Costo {formatRefAmount(item.previousCostRef)} → {formatRefAmount(item.currentCostRef)} REF
          </span>
          <span aria-hidden>·</span>
          <span>PVP {currentPrice} REF</span>
          <span aria-hidden>·</span>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            ganancia
            <MarginBadge pct={item.previousMarginPct} thresholds={thresholds} />
            <span aria-hidden>→</span>
            <span className="sr-only">pasa a</span>
            <MarginBadge pct={item.currentMarginPct} thresholds={thresholds} />
          </span>
        </p>
        <p className="text-sm font-medium tabular-nums text-foreground">
          Reprecio al {formatMarkupPct(proposal.markupPct)} → {proposedPrice} REF
        </p>
        {error && !isConfirmOpen ? (
          <p className="break-words text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {canManage ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            disabled={isLocked}
            onClick={() => {
              setError(null);
              setIsConfirmOpen(true);
            }}
            size="sm"
          >
            Aplicar
          </Button>
          <Button disabled={isLocked} onClick={() => void handleKeep()} size="sm" variant="outline">
            Mantener precio
          </Button>
        </div>
      ) : null}

      {canManage ? (
        <ConfirmActionModal
          confirmLabel="Aplicar precio"
          description={`El precio de ${item.name} pasa de ${currentPrice} a ${proposedPrice} REF.`}
          effects={[
            {
              after: `${proposedPrice} REF`,
              before: `${currentPrice} REF`,
              label: "Precio de venta",
              tone: "positive",
            },
            {
              after: formatMarkupPct(proposal.markupPct),
              before: formatMarkupPct(item.currentMarginPct),
              label: "Ganancia sobre el costo",
              tone: "positive",
            },
          ]}
          error={error}
          isPending={updatePrice.isPending}
          onConfirm={handleApply}
          onOpenChange={setIsConfirmOpen}
          open={isConfirmOpen}
          title="Aplicar reprecio"
        />
      ) : null}
    </li>
  );
}

function PurchaseRepriceList({ canManage, purchaseId }: { canManage: boolean; purchaseId: string }) {
  const review = usePriceReview({ limit: MAX_PAGE_LIMIT, purchaseId });
  const pricing = usePricingSettings();
  const [showAll, setShowAll] = useState(false);

  if (review.isError) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-on-surface-variant" role="status">
        No pudimos comprobar si esta compra bajó la ganancia de algún producto.
        <Button onClick={() => void review.refetch()} size="sm" variant="ghost">
          Reintentar
        </Button>
      </p>
    );
  }

  const items = review.data?.items ?? [];

  if (items.length === 0) {
    return null;
  }

  const total = Math.max(review.data?.total ?? 0, items.length);
  const visibleItems = showAll ? items : items.slice(0, PURCHASE_REPRICE_VISIBLE_ROWS);
  const hiddenCount = items.length - visibleItems.length;
  const supplierName = items.find((item) => item.purchase?.supplierName)?.purchase?.supplierName;
  const thresholds = getProductMarginThresholds(pricing.data);

  return (
    <section
      aria-labelledby="purchase-reprice-title"
      className="rounded-lg border border-border bg-surface-container-lowest p-4 shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <TrendingDown aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground" id="purchase-reprice-title">
              Productos que bajaron de ganancia con esta compra
            </h3>
            <p className="mt-0.5 break-words text-sm text-on-surface-variant">
              {total === 1 ? "1 producto" : `${total} productos`}
              {supplierName ? ` · Proveedor: ${supplierName}` : ""}
            </p>
          </div>
        </div>
        {total > PURCHASE_REPRICE_VISIBLE_ROWS ? (
          <Link
            className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline dark:text-indigo-300"
            href={PRODUCTS_REVIEW_HREF}
          >
            Ver todos en Productos
          </Link>
        ) : null}
      </header>

      <ul className="mt-2 divide-y divide-border">
        {visibleItems.map((item) => (
          <PurchaseRepriceRow
            canManage={canManage}
            item={item}
            key={item.productId}
            thresholds={thresholds}
          />
        ))}
      </ul>

      {hiddenCount > 0 ? (
        <Button className="mt-2" onClick={() => setShowAll(true)} size="sm" variant="ghost">
          Mostrar {hiddenCount} más
        </Button>
      ) : null}
    </section>
  );
}

/**
 * Aviso del detalle de una compra (PRO-10): productos cuyo costo subió con ella
 * y cuya ganancia bajó de banda, con "Aplicar" (reprecio al % que tenían) y
 * "Mantener precio". Nunca cambia un precio sin el clic del usuario (regla 10b).
 *
 * Sin filas, mientras carga o sin permiso `products.view` no pinta nada; las
 * acciones exigen `products.manage`.
 */
export function PurchaseRepriceNotice({ purchaseId }: { purchaseId: string }) {
  const { can } = usePermission();

  if (!purchaseId || !can("products.view")) {
    return null;
  }

  return <PurchaseRepriceList canManage={can("products.manage")} purchaseId={purchaseId} />;
}
