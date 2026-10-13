"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Link2, Loader2, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";
import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";
import { paymentMethodLabels } from "@/modules/payments/payment-details/utils/paymentDetailLabels";
import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import { getProductMarginThresholds } from "@/modules/products/services/productMargin";
import type { PricingSettings } from "@/modules/settings/hooks/useSettings";
import { apiFetch, ClientApiError } from "@/shared/api/apiFetch";
import { Badge } from "@/shared/components/Badge";
import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { MarginBadge } from "@/shared/components/MarginBadge/MarginBadge";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { purchasesQueryKeys } from "../../hooks/usePurchases";
import { usePurchaseConfirmScanGuard } from "../hooks/usePurchaseConfirmScanGuard";
import {
  buildPurchaseConfirmEffect,
  type PurchaseConfirmEffect,
  type PurchaseConfirmFacts,
  type PurchaseConfirmInput,
  type PurchaseConfirmLine,
  type PurchaseConfirmPayment,
  type PurchaseConfirmPaymentSource,
  type PurchaseConfirmProductFacts,
} from "../utils/purchaseConfirmEffect";

/** Fichas de producto que se consultan a la vez (los que el proveedor no tiene vinculados). */
const PRODUCT_BATCH_SIZE = 8;

/**
 * Lo que el formulario no guarda y el modal compara: costo actual y precio de cada
 * producto, su vínculo con el proveedor (activo, inactivo o ninguno) y los cortes del
 * semáforo de la tienda. Solo lecturas de endpoints que la pantalla ya usa: los
 * vínculos del proveedor (traen el producto) y, para el resto, la ficha del producto.
 * Un producto que ya no existe (404) queda sin dato.
 */
export async function fetchPurchaseConfirmFacts(
  supplierId: string,
  productIds: readonly string[],
): Promise<PurchaseConfirmFacts> {
  const wanted = new Set(productIds);
  const [links, pricing] = await Promise.all([
    fetchAllPaginatedItems<SupplierProduct>(`/api/suppliers/${supplierId}/products`),
    apiFetch<PricingSettings>("/api/settings/pricing"),
  ]);
  const products = new Map<string, PurchaseConfirmProductFacts>();
  const linkByProductId = new Map<string, PurchaseConfirmProductFacts["link"]>();

  for (const row of links) {
    if (!wanted.has(row.productId)) {
      continue;
    }

    const link = row.isActive === false ? "inactive" : "active";

    linkByProductId.set(row.productId, link);

    if (row.product) {
      products.set(row.productId, {
        currentCostRef: row.product.currentCostRef,
        link,
        salePriceRef: row.product.salePriceRef,
      });
    }
  }

  const pendingIds = [...wanted].filter((productId) => !products.has(productId));

  for (let start = 0; start < pendingIds.length; start += PRODUCT_BATCH_SIZE) {
    const batch = pendingIds.slice(start, start + PRODUCT_BATCH_SIZE);
    const found = await Promise.all(
      batch.map(async (productId) => {
        try {
          return await apiFetch<ProductWithCategory>(`/api/products/${productId}`);
        } catch (error) {
          if (error instanceof ClientApiError && error.status === 404) {
            return null;
          }

          throw error;
        }
      }),
    );

    batch.forEach((productId, index) => {
      const product = found[index];

      if (product) {
        products.set(productId, {
          currentCostRef: product.currentCostRef,
          link: linkByProductId.get(productId) ?? "none",
          salePriceRef: product.salePriceRef,
        });
      }
    });
  }

  return { products, thresholds: getProductMarginThresholds(pricing) };
}

/** `loading`: se está consultando; `error`: no se pudo; `ready`: el efecto ya compara. */
export type PurchaseConfirmFactsStatus = "error" | "loading" | "ready";

const PAYMENT_SOURCE_LABEL: Record<PurchaseConfirmPaymentSource, string> = {
  vault_account: "Sale de la cuenta bancaria del baúl",
  vault_cash_ref: "Sale del efectivo en USD del baúl",
  vault_cash_ves: "Sale del efectivo en Bs del baúl",
};

const noticeClassName =
  "flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300";

function describeLineCount(count: number) {
  return count === 1 ? "1 línea" : `${count} líneas`;
}

function describeProductCount(count: number) {
  return count === 1 ? "1 producto" : `${count} productos`;
}

function paymentAmountLabel(payment: PurchaseConfirmPayment) {
  const inVes = payment.currency === "VES";
  const amount = inVes ? formatVesBs(payment.amount) : formatRefUsd(payment.amount);

  if (payment.equivalent === null) {
    return amount;
  }

  return `${amount} (${inVes ? formatRefUsd(payment.equivalent) : formatVesBs(payment.equivalent)})`;
}

function quantityLabel(line: PurchaseConfirmLine) {
  if (!line.pack) {
    return `${line.quantity} und`;
  }

  const { count, label, unitsPerPack } = line.pack;

  return `${count} × ${label || "Empaque"} de ${unitsPerPack} = ${line.quantity} und`;
}

function SummaryRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <>
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-foreground">{children}</dd>
    </>
  );
}

function ConfirmSummary({
  effect,
  factsStatus,
}: {
  effect: PurchaseConfirmEffect;
  factsStatus: PurchaseConfirmFactsStatus;
}) {
  const { payment } = effect;
  const summaryRef = useRef<HTMLDivElement | null>(null);

  // El foco inicial va al resumen, no a «Registrar compra» (CNF-F5): esta pantalla se usa
  // con lector, y un Enter que llegue sin querer no debe encontrar el botón enfocado. Este
  // efecto corre después del foco inicial de `ConfirmActionModal` (va detrás en el árbol).
  useEffect(() => {
    summaryRef.current?.focus();
  }, []);

  return (
    <div
      aria-label="Resumen de la compra"
      className="space-y-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      ref={summaryRef}
      role="group"
      tabIndex={-1}
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <SummaryRow label="Proveedor">{effect.supplierName ?? "Proveedor elegido"}</SummaryRow>
        <SummaryRow label="Líneas">{describeLineCount(effect.lines.length)}</SummaryRow>
        {effect.discountRef > 0 ? (
          <SummaryRow label="Descuento">
            <span className="tabular-nums">− {formatRefUsd(effect.discountRef)}</span>
          </SummaryRow>
        ) : null}
        <SummaryRow label="Total">
          <span className="tabular-nums">
            {formatRefUsd(effect.totalRef)} · {formatVesBs(effect.totalVes)}
          </span>
        </SummaryRow>
        <SummaryRow label="Tasa">
          <span className="tabular-nums">{formatVesBs(effect.rateVes)} por REF</span>
        </SummaryRow>
        <SummaryRow label="Pago ahora">
          {payment ? (
            <>
              <span className="tabular-nums">
                {paymentMethodLabels[payment.method]} · {paymentAmountLabel(payment)}
              </span>
              <span className="block text-xs font-normal text-on-surface-variant">
                {PAYMENT_SOURCE_LABEL[payment.source]}. Si no alcanza el saldo, la compra se
                registra y el pago queda pendiente.
              </span>
            </>
          ) : (
            "Sin pago: queda por pagar"
          )}
        </SummaryRow>
        {effect.newLinkNames.length > 0 ? (
          <SummaryRow label="Vínculos nuevos">
            {describeProductCount(effect.newLinkNames.length)}
            <span className="block text-xs font-normal text-on-surface-variant">
              Quedan vinculados al proveedor por primera vez
            </span>
          </SummaryRow>
        ) : null}
      </dl>

      {effect.receivesNow ? null : (
        <p className={noticeClassName} role="note">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            El inventario NO cambia hasta recibir: no entra stock ni cambian los costos. Se
            registra el pedido{payment ? " y su pago" : ""}.
          </span>
        </p>
      )}

      {factsStatus === "loading" ? (
        <p
          aria-live="polite"
          className="flex items-center gap-2 text-xs text-on-surface-variant"
          role="status"
        >
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
          {effect.receivesNow
            ? "Consultando el costo actual y los vínculos de los productos…"
            : "Consultando los vínculos de los productos…"}
        </p>
      ) : null}

      {factsStatus === "error" ? (
        <p className={noticeClassName} role="note">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {effect.receivesNow
              ? "No pudimos consultar el costo actual ni los vínculos de los productos: no se muestran el costo anterior, la ganancia que baja de banda ni los vínculos nuevos. Las cantidades, el costo nuevo y los montos sí son los de esta compra."
              : "No pudimos consultar los vínculos de los productos: no se muestran los vínculos nuevos. Las cantidades y los montos sí son los de este pedido."}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function CostChange({ cost }: { cost: NonNullable<PurchaseConfirmLine["cost"]> }) {
  if (cost.beforeRef === null) {
    return <span className="font-semibold">{formatRefUsd(cost.afterRef)}</span>;
  }

  if (cost.beforeRef === cost.afterRef) {
    return (
      <>
        <span className="font-semibold">{formatRefUsd(cost.afterRef)}</span>
        <span className="text-on-surface-variant">(sin cambio)</span>
      </>
    );
  }

  return (
    <>
      <span className="text-on-surface-variant">{formatRefUsd(cost.beforeRef)}</span>
      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="sr-only">pasa a</span>
      <span className="font-semibold">{formatRefUsd(cost.afterRef)}</span>
    </>
  );
}

function ConfirmLine({
  effect,
  line,
}: {
  effect: PurchaseConfirmEffect;
  line: PurchaseConfirmLine;
}) {
  const { cost, disassemble } = line;
  const thresholds = effect.thresholds;

  return (
    <li className="space-y-2 py-3 text-sm">
      <p className="break-words font-medium text-foreground">{line.name}</p>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-on-surface-variant">{effect.receivesNow ? "Entra" : "Pedido"}</dt>
        <dd className="break-words text-right font-medium tabular-nums text-foreground">
          {quantityLabel(line)}
        </dd>

        {cost ? (
          <>
            <dt className="text-on-surface-variant">Costo (con IVA)</dt>
            <dd className="flex flex-wrap items-center justify-end gap-1.5 font-mono tabular-nums text-foreground">
              <CostChange cost={cost} />
            </dd>
          </>
        ) : null}

        {cost?.marginDrop ? (
          <>
            <dt className="text-on-surface-variant">Ganancia</dt>
            <dd className="flex flex-wrap items-center justify-end gap-1.5">
              <MarginBadge pct={cost.marginDrop.previousPct} thresholds={thresholds} />
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="sr-only">baja a</span>
              <MarginBadge pct={cost.marginDrop.pct} review thresholds={thresholds} />
            </dd>
          </>
        ) : null}
      </dl>

      {disassemble && !effect.receivesNow ? (
        <p className="text-xs font-medium text-on-surface-variant">
          Marcada para desarmar al recibir
        </p>
      ) : null}

      {disassemble && effect.receivesNow ? (
        <div className="space-y-1.5 rounded-md bg-surface-container-low px-3 py-2 text-xs">
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-on-surface-variant">Se desarma al recibir (sale)</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">
              −{disassemble.packs} und
            </span>
          </p>
          {disassemble.components.length > 0 ? (
            <ul aria-label={`Componentes que entran al desarmar ${line.name}`} className="space-y-1">
              {disassemble.components.map((component, index) => (
                <li
                  className="flex items-baseline justify-between gap-3"
                  key={`${index}-${component.name}`}
                >
                  <span className="min-w-0 break-words text-foreground">{component.name}</span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">
                    +{component.units} und
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-on-surface-variant">
            El costo de cada componente se promedia con su stock al abrir el empaque.
          </p>
        </div>
      ) : null}

      {line.firstLink ? (
        <Badge className="gap-1" variant="info">
          <Link2 aria-hidden="true" className="h-3 w-3 shrink-0" />
          Vínculo nuevo con el proveedor
        </Badge>
      ) : null}
    </li>
  );
}

export type PurchaseConfirmModalViewProps = {
  /** `null` con el modal cerrado. */
  effect: PurchaseConfirmEffect | null;
  /** Mensaje del servidor al fallar el registro; se muestra tal cual. */
  error?: string | null;
  factsStatus: PurchaseConfirmFactsStatus;
  isPending?: boolean;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  /**
   * El lector de códigos disparó con la confirmación abierta: los códigos posibles, o
   * `null` si la ráfaga no medía como un código. Ese Enter nunca llega a «Registrar».
   */
  onScan?: (candidates: string[] | null) => void;
  open: boolean;
};

/**
 * Confirmación de «Confirmar Compra» (CNF-01): arriba el resumen (proveedor, líneas,
 * total, tasa, pago y de dónde sale, vínculos nuevos) y debajo, con scroll propio, lo
 * que hace cada línea. En un pedido avisa de que el inventario no cambia y no pinta
 * costos. Solo presenta: el efecto llega calculado (`buildPurchaseConfirmEffect`).
 */
export function PurchaseConfirmModalView({
  effect,
  error,
  factsStatus,
  isPending = false,
  onConfirm,
  onOpenChange,
  onScan,
  open,
}: PurchaseConfirmModalViewProps) {
  const receivesNow = effect?.receivesNow ?? true;

  const onScannerInput = usePurchaseConfirmScanGuard(onScan);

  return (
    <ConfirmActionModal
      confirmLabel={receivesNow ? "Registrar compra" : "Registrar pedido"}
      description={
        receivesNow
          ? "La mercancía entra al inventario y el costo de cada producto se actualiza al confirmar."
          : "Se registra el pedido al proveedor; la mercancía se recibe después."
      }
      error={error}
      isPending={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      onScannerInput={onScannerInput}
      open={open && effect !== null}
      renderEffects={() =>
        effect ? (
          <ul
            aria-label={receivesNow ? "Mercancía que entra" : "Mercancía pedida"}
            className="divide-y divide-border"
          >
            {effect.lines.map((line) => (
              <ConfirmLine effect={effect} key={line.itemId} line={line} />
            ))}
          </ul>
        ) : null
      }
      title={receivesNow ? "Confirmar compra" : "Confirmar pedido"}
    >
      {effect ? <ConfirmSummary effect={effect} factsStatus={factsStatus} /> : null}
    </ConfirmActionModal>
  );
}

export type PurchaseConfirmModalProps = Omit<
  PurchaseConfirmModalViewProps,
  "effect" | "factsStatus"
> & {
  /** La compra en curso, sin lo consultado: el modal lo pide al abrirse. */
  input: Omit<PurchaseConfirmInput, "facts">;
  supplierId: string;
};

/**
 * El modal de confirmación con sus datos: al abrirse consulta el costo actual, el
 * precio y los vínculos de los productos de la compra, y arma el efecto con lo que
 * recibe en `input`. Mientras llegan (o si fallan) muestra lo que ya se sabe —lo que
 * entra, el costo nuevo, los montos y el pago— y lo dice.
 */
export function PurchaseConfirmModal({
  input,
  open,
  supplierId,
  ...viewProps
}: PurchaseConfirmModalProps) {
  const productIds = open
    ? [...new Set(input.lines.map((line) => line.item.productId))].sort()
    : [];
  const facts = useQuery({
    enabled: open && supplierId !== "" && productIds.length > 0,
    // Cada apertura consulta de nuevo: el costo pudo cambiar desde la anterior.
    gcTime: 0,
    queryFn: () => fetchPurchaseConfirmFacts(supplierId, productIds),
    queryKey: [...purchasesQueryKeys.all, "confirm-facts", supplierId, productIds],
    retry: 1,
    staleTime: 0,
  });
  // Solo vale una respuesta al día: una que se está refrescando puede ser de antes.
  const knownFacts = facts.isSuccess && !facts.isFetching ? facts.data : null;
  const factsStatus: PurchaseConfirmFactsStatus = knownFacts
    ? "ready"
    : facts.isError && !facts.isFetching
      ? "error"
      : "loading";

  return (
    <PurchaseConfirmModalView
      {...viewProps}
      effect={open ? buildPurchaseConfirmEffect({ ...input, facts: knownFacts }) : null}
      factsStatus={factsStatus}
      open={open}
    />
  );
}
