"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { getCaracasIsoDate, toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";
import { withReturnTo } from "@/shared/utils/returnTo";

import { RegisterPaymentModal } from "../../components/RegisterPaymentModal";
import { type OpenDocument, useOpenDocuments } from "../../hooks/useOpenDocuments";

/** Días (fecha Caracas) a partir de los cuales una venta sin cobrar se considera abandonada. */
export const STALE_PENDING_SALE_DAYS = 7;

/** Ventas que se cargan en el desplegable; si hay más, el aviso lo dice. */
const STALE_PENDING_SALES_LIMIT = 50;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type StalePendingSalesNoticeProps = {
  /** URL exacta de la lista (`list.href`): viaja como `returnTo` al detalle de la venta. */
  listHref: string;
};

function isoDateToUtcMs(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);

  return Date.UTC(year, month - 1, day);
}

/** `YYYY-MM-DD` (Caracas) como `DD/MM/YYYY`. */
function formatIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-");

  return `${day}/${month}/${year}`;
}

function formatBalance(pendingRef: number | undefined, pendingVes: number) {
  return pendingRef === undefined
    ? formatVesBs(pendingVes)
    : `${formatRefUsd(pendingRef)} · ${formatVesBs(pendingVes)}`;
}

function sumMoney(values: number[]) {
  return roundMoney(values.reduce((sum, value) => sum + value, 0));
}

/**
 * Aviso de `/payments`: ventas en `pendiente_pago` desde hace
 * `STALE_PENDING_SALE_DAYS` días o más. Su mercancía sigue descontada del
 * inventario hasta que se cobren o se anulen, y nada las vence solas.
 *
 * Solo informa y da acceso: «Cobrar» abre el modal de pago y «Ver venta» lleva al
 * detalle, donde está «Anular». Sin permiso, cargando, con error o sin ventas no
 * pinta nada.
 */
export function StalePendingSalesNotice({ listHref }: StalePendingSalesNoticeProps) {
  const { can } = usePermission();
  const canView = can("payments.manage") || can("sales.create");
  const [payingSaleId, setPayingSaleId] = useState<string | null>(null);
  const documents = useOpenDocuments(
    { limit: STALE_PENDING_SALES_LIMIT, olderThanDays: STALE_PENDING_SALE_DAYS, type: "sale" },
    { enabled: canView },
  );
  const { refetch } = documents;

  // Anular una venta en su detalle no invalida esta consulta: al volver a la lista
  // se pide de nuevo aunque la caché siga vigente (si ya hay una petición, se reutiliza).
  useEffect(() => {
    if (canView) {
      void refetch({ cancelRefetch: false });
    }
  }, [canView, refetch]);

  // La `key` mantiene el mismo modal montado cuando el aviso aparece o desaparece
  // a su lado: cobrar la última venta quita el aviso, no el resultado del cobro.
  const paymentModal = canView ? (
    <RegisterPaymentModal
      key="payment-modal"
      onOpenChange={(open) => {
        if (!open) {
          setPayingSaleId(null);
        }
      }}
      open={payingSaleId !== null}
      saleId={payingSaleId ?? undefined}
    />
  ) : null;

  if (!canView || !documents.data || documents.isError || !documents.isFetchedAfterMount) {
    return paymentModal;
  }

  const { items, total, totals } = documents.data;
  const sales = items.filter((document) => document.status === "pendiente_pago");

  if (totals.count === 0 || sales.length === 0) {
    return paymentModal;
  }

  // Lo cargado que no está en `pendiente_pago` se descuenta de los totales del servidor.
  const excluded = items.filter((document) => document.status !== "pendiente_pago");
  const notLoadedCount = Math.max(0, total - items.length);
  const count = Math.max(sales.length, totals.count - excluded.length);
  const pendingVes = roundMoney(
    totals.pendingVes - sumMoney(excluded.map((document) => document.pendingVes)),
  );
  const pendingRef =
    totals.pendingRef === undefined
      ? undefined
      : roundMoney(
          totals.pendingRef - sumMoney(excluded.map((document) => document.pendingRef ?? 0)),
        );
  const today = getCaracasIsoDate();
  const isPlural = count !== 1;

  return (
    <>
      <section
        aria-label="Ventas pendientes de pago"
        className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
      >
        <div className="flex min-w-0 items-start gap-3">
          <TriangleAlert
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold text-amber-900 [overflow-wrap:anywhere] dark:text-amber-200">
              {totals.truncated ? "Al menos " : ""}
              {count} {isPlural ? "ventas llevan" : "venta lleva"} {STALE_PENDING_SALE_DAYS} días o
              más {isPlural ? "pendientes" : "pendiente"} de pago
            </p>
            <p className="text-sm text-amber-900 [overflow-wrap:anywhere] dark:text-amber-200">
              Total pendiente:{" "}
              <span className="font-semibold tabular-nums">
                {formatBalance(pendingRef, pendingVes)}
              </span>
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-300">
              La mercancía de estas ventas sigue apartada del inventario: no se puede vender a
              nadie más hasta que la venta se cobre o se anule.
            </p>
          </div>
        </div>

        <CollapsibleSection
          className="mt-3 border-amber-200 dark:border-amber-900"
          title={<span className="text-sm">{isPlural ? "Ver las ventas" : "Ver la venta"}</span>}
        >
          <ul className="divide-y divide-border">
            {sales.map((sale) => (
              <StalePendingSaleRow
                key={sale.id}
                listHref={listHref}
                onCollect={() => setPayingSaleId(sale.id)}
                sale={sale}
                today={today}
              />
            ))}
          </ul>
          {notLoadedCount > 0 ? (
            <p className="pt-3 text-sm text-on-surface-variant">
              y {notLoadedCount} más. Cobre o anule las de arriba para ver las siguientes.
            </p>
          ) : null}
        </CollapsibleSection>
      </section>
      {paymentModal}
    </>
  );
}

type StalePendingSaleRowProps = {
  listHref: string;
  onCollect: () => void;
  sale: OpenDocument;
  /** Hoy en Caracas, `YYYY-MM-DD`. */
  today: string;
};

function StalePendingSaleRow({ listHref, onCollect, sale, today }: StalePendingSaleRowProps) {
  const saleDate = toCaracasDateKey(sale.createdAt);
  const ageDays = Math.round((isoDateToUtcMs(today) - isoDateToUtcMs(saleDate)) / MS_PER_DAY);

  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-[13px] font-semibold text-foreground">{sale.number}</span>
          <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">
            {sale.contact?.name ?? "Sin cliente"}
          </span>
        </p>
        <p className="text-on-surface-variant">
          {formatIsoDate(saleDate)} · hace {ageDays} {ageDays === 1 ? "día" : "días"}
        </p>
        <p className="font-medium tabular-nums text-foreground">
          Saldo: {formatBalance(sale.pendingRef, sale.pendingVes)}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          aria-label={`Cobrar venta ${sale.number}`}
          onClick={onCollect}
          size="sm"
          type="button"
        >
          Cobrar
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link
            aria-label={`Ver venta ${sale.number}`}
            href={withReturnTo(`/sales/${sale.id}`, listHref)}
          >
            Ver venta
          </Link>
        </Button>
      </div>
    </li>
  );
}
