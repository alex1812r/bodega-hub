"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { formatRefUsd } from "@/shared/utils/currency";

import {
  payrollPeriodStatusLabels,
  payrollPeriodStatusVariants,
} from "../components/payrollLabels";
import {
  useComputePayrollPeriod,
  usePayrollCurrent,
  usePayrollPeriods,
  usePayrollSettings,
} from "../hooks/usePayroll";
import type { PayrollPeriod } from "../types";
import { formatPeriodLabel } from "../utils/quincena";

export function PayrollHomePage() {
  const router = useRouter();
  const currentQuery = usePayrollCurrent();
  const periodsQuery = usePayrollPeriods({ limit: 10 });
  const settingsQuery = usePayrollSettings();
  const computePeriod = useComputePayrollPeriod();
  const [computeError, setComputeError] = useState<string | null>(null);

  const current = currentQuery.data;
  const employees = settingsQuery.data?.employees ?? [];
  const hasConfiguredEmployee = employees.some(
    (employee) => employee.employeeId !== null && employee.isActive,
  );
  const showNoEmployeesWarning = !settingsQuery.isLoading && !hasConfiguredEmployee;

  const columns = useMemo<DataTableColumn<PayrollPeriod>[]>(
    () => [
      {
        header: "Quincena",
        key: "periodKey",
        render: (period) => (
          <Link className="font-medium text-primary hover:underline" href={`/payroll/${period.id}`}>
            {formatPeriodLabel(period.periodKey)}
          </Link>
        ),
      },
      {
        header: "Estado",
        key: "status",
        render: (period) => (
          <Badge variant={payrollPeriodStatusVariants[period.status]}>
            {payrollPeriodStatusLabels[period.status]}
          </Badge>
        ),
      },
      {
        align: "right",
        header: "Ventas REF",
        key: "salesRef",
        render: (period) => (
          <span className="tabular-nums text-on-surface-variant">
            {formatRefUsd(period.salesRef)}
          </span>
        ),
        visibility: "md",
      },
      {
        align: "right",
        header: "Comision",
        key: "commissionRef",
        render: (period) => (
          <span className="tabular-nums text-on-surface-variant">
            {formatRefUsd(period.commissionRef)}
          </span>
        ),
        visibility: "lg",
      },
      {
        align: "right",
        header: "Total nomina",
        key: "totalRef",
        render: (period) => (
          <strong className="tabular-nums">{formatRefUsd(period.totalRef)}</strong>
        ),
      },
    ],
    [],
  );

  async function handleCompute(periodKey: string) {
    setComputeError(null);

    try {
      const period = await computePeriod.mutateAsync({ periodKey });
      router.push(`/payroll/${period.id}`);
    } catch (error) {
      setComputeError(
        error instanceof Error ? error.message : "No pudimos calcular la quincena.",
      );
    }
  }

  return (
    <EntityListPage
      description="Comision de los cajeros por quincena: calcular, aprobar y pagar."
      layout="sections"
      title="Nomina"
    >
      {showNoEmployeesWarning ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Ningun empleado tiene porcentaje de comision configurado, asi que la quincena saldra en
          cero.{" "}
          <Link className="font-medium underline" href="/payroll/settings">
            Configurar comisiones
          </Link>
          .
        </p>
      ) : null}

      {computeError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {computeError}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quincena anterior</CardTitle>
            <CardDescription>
              {current
                ? `${current.previousPeriodKey} · ${formatPeriodLabel(current.previousPeriodKey)}`
                : "Cargando..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {current?.previousPeriod ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant={payrollPeriodStatusVariants[current.previousPeriod.status]}>
                    {payrollPeriodStatusLabels[current.previousPeriod.status]}
                  </Badge>
                </div>
                <p className="text-3xl font-semibold tabular-nums text-foreground">
                  {formatRefUsd(current.previousPeriod.totalRef)}
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/payroll/${current.previousPeriod.id}`}>Ver quincena</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-on-surface-variant">
                  Todavia no calculamos esta quincena. Al calcular se crea un borrador que puedes
                  recalcular hasta aprobarlo.
                </p>
                <Button
                  disabled={computePeriod.isPending || !current}
                  onClick={() => {
                    if (current) {
                      void handleCompute(current.previousPeriodKey);
                    }
                  }}
                  size="sm"
                >
                  {computePeriod.isPending ? "Calculando..." : "Calcular"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Quincena en curso</CardTitle>
              <Badge variant="info">Estimacion</Badge>
            </div>
            <CardDescription>
              {current
                ? `${current.currentPeriodKey} · ${formatPeriodLabel(current.currentPeriodKey)}`
                : "Cargando..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-semibold tabular-nums text-foreground">
              {currentQuery.isLoading ? "—" : formatRefUsd(current?.estimateTotalRef ?? 0)}
            </p>
            <p className="text-xs text-on-surface-variant">
              Estimacion viva: cambia con cada venta cobrada y no escribe nada todavia. La
              quincena solo se puede calcular cuando termina.
            </p>
            {current && current.estimate.length > 0 ? (
              <ul className="divide-y divide-outline-variant">
                {current.estimate.map((row) => (
                  <li
                    className="flex items-center justify-between gap-3 py-2"
                    key={row.profileId}
                  >
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {row.fullName}
                      <span className="ml-1 text-xs text-on-surface-variant">
                        ({row.salesCount} ventas · {row.commissionPct.toFixed(2)} %)
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-sm font-medium text-foreground">
                      {formatRefUsd(row.totalRef)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historial de quincenas</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            cardSubtitle={(period) => payrollPeriodStatusLabels[period.status]}
            cardTitle={(period) => formatPeriodLabel(period.periodKey)}
            columns={columns}
            data={periodsQuery.data?.items ?? []}
            embedded
            emptyState={
              <EmptyState
                className="py-10"
                description="Las quincenas calculadas apareceran aqui."
                title="Sin quincenas"
              />
            }
            error={periodsQuery.error}
            getRowId={(period) => period.id}
            isLoading={periodsQuery.isLoading}
            onRetry={() => void periodsQuery.refetch()}
          />
        </CardContent>
      </Card>
    </EntityListPage>
  );
}
