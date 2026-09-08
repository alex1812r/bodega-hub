"use client";

import { useMemo } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { PageBackButton } from "@/shared/components/PageBackButton";

import { usePayrollPeriods, usePayrollSettings } from "../hooks/usePayroll";

import { PayrollEmployeeRow } from "./components/PayrollEmployeeRow";
import { PayrollSettingsForm } from "./components/PayrollSettingsForm";
import { PayrollSimulator } from "./components/PayrollSimulator";

const AVERAGE_PERIODS = 3;

export function PayrollSettingsPage() {
  const settingsQuery = usePayrollSettings();
  const periodsQuery = usePayrollPeriods({ limit: 10 });

  const settings = settingsQuery.data?.settings;
  const employees = settingsQuery.data?.employees ?? [];

  /** Promedio de ganancia bruta de las ultimas quincenas con dato, para el simulador. */
  const { averageGrossProfitRef, periodsInAverage } = useMemo(() => {
    const values = (periodsQuery.data?.items ?? [])
      .map((period) => period.grossProfitRef)
      .filter((value): value is number => value != null)
      .slice(0, AVERAGE_PERIODS);

    if (values.length === 0) {
      return { averageGrossProfitRef: null, periodsInAverage: 0 };
    }

    const total = values.reduce((accumulator, value) => accumulator + value, 0);

    return {
      averageGrossProfitRef: total / values.length,
      periodsInAverage: values.length,
    };
  }, [periodsQuery.data]);

  return (
    <EntityListPage
      actions={<PageBackButton href="/payroll" label="Volver a nomina" size="sm" />}
      description="Parametros de comision y empleados que cobran nomina."
      layout="sections"
      title="Configuracion de nomina"
    >
      <Card>
        <CardHeader>
          <CardTitle>Parametros</CardTitle>
          <CardDescription>
            Aplican a las quincenas que se calculen a partir de ahora; las ya calculadas guardan
            su propio snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settingsQuery.isLoading ? (
            <p className="text-sm text-on-surface-variant">Cargando parametros...</p>
          ) : settings ? (
            <PayrollSettingsForm key={settings.updatedAt} settings={settings} />
          ) : (
            <p className="text-sm text-destructive">No pudimos cargar la configuracion.</p>
          )}
        </CardContent>
      </Card>

      <PayrollSimulator
        averageGrossProfitRef={averageGrossProfitRef}
        defaultCommissionPct={settings?.defaultCommissionPct ?? 3}
        periodsInAverage={periodsInAverage}
      />

      <Card>
        <CardHeader>
          <CardTitle>Empleados elegibles</CardTitle>
          <CardDescription>
            Perfiles activos de la tienda con un rol elegible. Un empleado inactivo no genera
            item en la quincena.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settingsQuery.isLoading ? (
            <p className="text-sm text-on-surface-variant">Cargando empleados...</p>
          ) : settingsQuery.error ? (
            <p className="text-sm text-destructive">No pudimos cargar los empleados.</p>
          ) : employees.length === 0 ? (
            <EmptyState
              className="py-8"
              description="Ningun perfil de la tienda tiene un rol elegible para comisionar."
              title="Sin empleados elegibles"
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-outline-variant">
              <table className="min-w-full">
                <thead className="bg-surface-container-low text-left">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Empleado
                    </th>
                    <th className="hidden px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                      Rol
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Comision (%)
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => (
                    <PayrollEmployeeRow
                      defaultCommissionPct={settings?.defaultCommissionPct ?? 3}
                      employee={employee}
                      key={employee.profileId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </EntityListPage>
  );
}
