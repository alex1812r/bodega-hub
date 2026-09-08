"use client";

import { useState } from "react";

import { roleLabels } from "@/shared/auth/permissions";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";

import { useUpdatePayrollEmployee } from "../../hooks/usePayroll";
import type { PayrollEmployee } from "../../types";

type PayrollEmployeeRowProps = {
  defaultCommissionPct: number;
  employee: PayrollEmployee;
};

/** Una fila = un perfil elegible con su % de comision y su interruptor de activo. */
export function PayrollEmployeeRow({
  defaultCommissionPct,
  employee,
}: PayrollEmployeeRowProps) {
  const updateEmployee = useUpdatePayrollEmployee();
  const [commissionPct, setCommissionPct] = useState(
    String(employee.employeeId ? employee.commissionPct : defaultCommissionPct),
  );
  const [isActive, setIsActive] = useState(employee.isActive);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function save(nextIsActive: boolean, nextPct: number) {
    setErrorMessage(null);

    try {
      await updateEmployee.mutateAsync({
        commissionPct: nextPct,
        isActive: nextIsActive,
        profileId: employee.profileId,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo guardar.");
    }
  }

  const pctNumber = Number(commissionPct);
  const pctIsValid = Number.isFinite(pctNumber) && pctNumber >= 0 && pctNumber <= 100;

  return (
    <tr className="border-t border-outline-variant align-middle">
      <th className="px-3 py-2 text-left text-sm font-medium text-foreground" scope="row">
        {employee.fullName}
        {employee.employeeId === null ? (
          <Badge className="ml-2" variant="warning">
            Sin configurar
          </Badge>
        ) : null}
        {errorMessage ? (
          <span className="block text-xs text-destructive">{errorMessage}</span>
        ) : null}
      </th>
      <td className="hidden px-3 py-2 text-sm text-on-surface-variant md:table-cell">
        {roleLabels[employee.role]}
      </td>
      <td className="px-3 py-2">
        <Input
          aria-label={`Comision de ${employee.fullName}`}
          error={pctIsValid ? undefined : "Entre 0 y 100."}
          max="100"
          min="0"
          onChange={(event) => setCommissionPct(event.target.value)}
          step="0.01"
          type="number"
          value={commissionPct}
        />
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
          <input
            checked={isActive}
            className="h-4 w-4 rounded border-outline-variant accent-primary"
            onChange={(event) => {
              setIsActive(event.target.checked);

              if (pctIsValid) {
                void save(event.target.checked, pctNumber);
              }
            }}
            type="checkbox"
          />
          Activo
        </label>
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          disabled={!pctIsValid || updateEmployee.isPending}
          onClick={() => void save(isActive, pctNumber)}
          size="sm"
          variant="outline"
        >
          {updateEmployee.isPending ? "Guardando..." : "Guardar"}
        </Button>
      </td>
    </tr>
  );
}
