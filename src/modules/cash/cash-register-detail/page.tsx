"use client";

import { AlertTriangle, Banknote, CircleDollarSign, Landmark } from "lucide-react";
import { useMemo } from "react";

import { DashboardKpiCard } from "@/modules/dashboard/components/DashboardKpiCard";
import { Badge } from "@/shared/components/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { LoadingState } from "@/shared/components/LoadingState";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { PageHeader } from "@/shared/components/PageHeader";
import { Typography } from "@/shared/components/Typography";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { CashSessionCountdown } from "../components/CashSessionCountdown";
import { useCashRegister, useCashRegisterSessions } from "../hooks/useCash";
import { isCashSessionExpired } from "../utils/cashSessionDeadline";
import type { CashSession, CashSessionClosedReason } from "../types";

const closedReasonLabels: Record<CashSessionClosedReason, string> = {
  end_of_day: "Cierre automatico (medianoche)",
  manual: "Cierre manual",
  max_24h: "Cierre automatico (24 h)",
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("es-VE", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}

/** Un cierre sigue pendiente mientras no se haya transferido al baul y tenga monto. */
export function isPendingClosure(session: CashSession) {
  return (
    session.status === "closed" &&
    !session.vaultTransferredAt &&
    ((session.closingVes ?? 0) > 0 || (session.closingRef ?? 0) > 0)
  );
}

export function CashRegisterDetailPage({ id }: { id: string }) {
  const register = useCashRegister(id);
  const sessions = useCashRegisterSessions(id);

  const items = useMemo(() => sessions.data ?? [], [sessions.data]);
  const openSession = items.find((session) => session.status === "open");
  const pending = useMemo(() => items.filter(isPendingClosure), [items]);

  const pendingTotals = useMemo(
    () =>
      pending.reduce(
        (accumulator, session) => {
          accumulator.ref += session.closingRef ?? 0;
          accumulator.ves += session.closingVes ?? 0;
          if (session.absorbedBySessionId) {
            accumulator.absorbedRef += session.closingRef ?? 0;
            accumulator.absorbedVes += session.closingVes ?? 0;
          }
          return accumulator;
        },
        { absorbedRef: 0, absorbedVes: 0, ref: 0, ves: 0 },
      ),
    [pending],
  );

  const columns = useMemo<DataTableColumn<CashSession>[]>(
    () => [
      {
        header: "Apertura",
        hideInCard: true,
        key: "openedAt",
        render: (item) => (
          <div>
            <p className="text-sm text-foreground">{formatDateTime(item.openedAt)}</p>
            <p className="text-xs text-on-surface-variant tabular-nums">
              Fondo {formatVesBs(item.openingVes)} · {formatRefUsd(item.openingRef)}
            </p>
          </div>
        ),
      },
      {
        header: "Cierre",
        key: "closedAt",
        render: (item) =>
          item.status === "open" ? (
            <Badge variant={isCashSessionExpired(item.openedAt) ? "danger" : "info"}>
              {isCashSessionExpired(item.openedAt) ? "Vencida" : "En curso"}
            </Badge>
          ) : (
            <div>
              <p className="text-sm text-foreground">{formatDateTime(item.closedAt)}</p>
              <p className="text-xs text-on-surface-variant">
                {item.closedReason ? closedReasonLabels[item.closedReason] : "—"}
              </p>
            </div>
          ),
      },
      {
        align: "right",
        header: "Contado",
        key: "closing",
        render: (item) => {
          const ves = item.status === "open" ? item.liveTotals?.cashVes : item.closingVes;
          const ref = item.status === "open" ? item.liveTotals?.cashRef : item.closingRef;
          return (
            <div>
              <p className="font-semibold tabular-nums text-foreground">
                {formatVesBs(ves ?? 0)}
              </p>
              <p className="text-xs tabular-nums text-on-surface-variant">
                {formatRefUsd(ref ?? 0)}
              </p>
            </div>
          );
        },
      },
      {
        align: "right",
        header: "Diferencia",
        key: "difference",
        render: (item) => {
          if (item.status === "open") {
            return <span className="text-sm text-on-surface-variant">—</span>;
          }
          const ves = (item.closingVes ?? 0) - (item.theoreticalClosingVes ?? 0);
          const ref = (item.closingRef ?? 0) - (item.theoreticalClosingRef ?? 0);
          if (ves === 0 && ref === 0) {
            return <Badge variant="success">Cuadrada</Badge>;
          }
          return (
            <div>
              <p
                className={cn(
                  "font-medium tabular-nums",
                  ves < 0 ? "text-destructive" : "text-amber-600",
                )}
              >
                {formatVesBs(ves)}
              </p>
              {ref === 0 ? null : (
                <p className="text-xs tabular-nums text-on-surface-variant">
                  {formatRefUsd(ref)}
                </p>
              )}
            </div>
          );
        },
        visibility: "lg",
      },
      {
        header: "Baul",
        key: "vault",
        render: (item) => {
          if (item.status === "open") {
            return <span className="text-sm text-on-surface-variant">—</span>;
          }
          if (item.vaultTransferredAt) {
            return <Badge variant="success">Transferido</Badge>;
          }
          if (!isPendingClosure(item)) {
            return <span className="text-sm text-on-surface-variant">Sin monto</span>;
          }
          return <Badge variant="warning">Pendiente</Badge>;
        },
      },
    ],
    [],
  );

  if (register.isLoading) {
    return <LoadingState title="Cargando caja..." variant="page" />;
  }

  if (!register.data) {
    return <Typography variant="muted">No se pudo cargar la caja.</Typography>;
  }

  const item = register.data;

  return (
    <div className="space-y-5">
      <PageHeader
        actions={<PageBackButton href="/cash/registers" label="Volver a cajas" />}
        badge={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={item.isActive ? "success" : "default"}>
              {item.isActive ? "Activa" : "Inactiva"}
            </Badge>
            {openSession ? (
              <Badge variant={isCashSessionExpired(openSession.openedAt) ? "danger" : "info"}>
                {isCashSessionExpired(openSession.openedAt) ? "Turno vencido" : "Turno abierto"}
              </Badge>
            ) : (
              <Badge>Sin turno abierto</Badge>
            )}
          </div>
        }
        description={`Vendedor asignado: ${item.assignedUserName ?? "sin asignar"}.`}
        title={item.name}
      />

      {openSession ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DashboardKpiCard
            accentClassName="bg-amber-500/15"
            icon={Banknote}
            iconClassName="text-amber-600"
            label="Efectivo del turno Bs."
            trend={
              <p className="mt-1 text-xs text-muted-foreground">
                Fondo {formatVesBs(openSession.openingVes)} + ventas en efectivo.
              </p>
            }
            value={formatVesBs(openSession.liveTotals?.cashVes ?? openSession.openingVes)}
          />
          <DashboardKpiCard
            accentClassName="bg-emerald-500/15"
            icon={CircleDollarSign}
            iconClassName="text-emerald-600"
            label="Efectivo del turno REF"
            trend={
              <p className="mt-1 text-xs text-muted-foreground">
                Fondo {formatRefUsd(openSession.openingRef)} + ventas en divisas.
              </p>
            }
            value={formatRefUsd(openSession.liveTotals?.cashRef ?? openSession.openingRef)}
          />
          <DashboardKpiCard
            accentClassName="bg-indigo-500/15"
            icon={Landmark}
            iconClassName="text-indigo-600"
            label="Cobros en cuenta Bs."
            trend={
              <p className="mt-1 text-xs text-muted-foreground">
                Pago movil, transferencia y punto de este turno.
              </p>
            }
            value={formatVesBs(openSession.liveTotals?.accountVes ?? 0)}
          />
        </div>
      ) : null}

      <Card className={pending.length > 0 ? "border-amber-300/70" : undefined}>
        <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-3">
          <div className="flex items-start gap-2">
            {pending.length > 0 ? (
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
            ) : null}
            <div>
              <CardTitle className="text-base">Cierres pendientes por transferir al baul</CardTitle>
              <p className="mt-1 text-sm text-on-surface-variant">
                {pending.length === 0
                  ? "Esta caja no tiene cierres pendientes: todo el efectivo cerrado ya paso al baul."
                  : `${pending.length} cierre${pending.length === 1 ? "" : "s"} con efectivo que todavia no llega al baul.`}
              </p>
            </div>
          </div>
          {pending.length > 0 ? (
            <div className="shrink-0 text-right">
              <p className="font-semibold tabular-nums text-foreground">
                {formatVesBs(pendingTotals.ves)}
              </p>
              <p className="text-xs tabular-nums text-on-surface-variant">
                {formatRefUsd(pendingTotals.ref)}
              </p>
            </div>
          ) : null}
        </CardHeader>
        {pending.length > 0 ? (
          <CardContent className="space-y-3 p-4 pt-0">
            <ul className="divide-y divide-border rounded-lg border border-border">
              {pending.map((session) => (
                <li className="flex items-center justify-between gap-3 p-3" key={session.id}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      Cerrada {formatDateTime(session.closedAt)}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {session.closedReason ? closedReasonLabels[session.closedReason] : "—"}
                      {session.absorbedBySessionId ? " · absorbido (historico)" : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-foreground">
                      {formatVesBs(session.closingVes ?? 0)}
                    </p>
                    <p className="text-xs tabular-nums text-on-surface-variant">
                      {formatRefUsd(session.closingRef ?? 0)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {pendingTotals.absorbedVes > 0 || pendingTotals.absorbedRef > 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <strong className="tabular-nums">
                  {formatVesBs(pendingTotals.absorbedVes)} / {formatRefUsd(pendingTotals.absorbedRef)}
                </strong>{" "}
                vienen de cierres absorbidos por una apertura posterior, de antes de que la
                apertura tomara el fondo del baul. Ya se pueden transferir con{" "}
                <em>Transferir cierres</em>.
              </p>
            ) : null}
          </CardContent>
        ) : null}
      </Card>

      {openSession ? (
        <Card>
          <CardHeader className="p-4 pb-3">
            <CardTitle className="text-base">Turno en curso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0">
            <p className="text-sm text-on-surface-variant">
              Abierto el {formatDateTime(openSession.openedAt)}.
            </p>
            <CashSessionCountdown openedAt={openSession.openedAt} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Historial de turnos</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:px-4 sm:pb-4">
          <DataTable
            cardSubtitle={(session) => formatDateTime(session.openedAt)}
            cardTitle={(session) =>
              session.status === "open" ? "Turno en curso" : "Turno cerrado"
            }
            columns={columns}
            data={items}
            embedded
            emptyState={
              <p className="p-6 text-center text-sm text-on-surface-variant">
                Esta caja todavia no tiene turnos registrados.
              </p>
            }
            getRowId={(session) => session.id}
            isLoading={sessions.isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
