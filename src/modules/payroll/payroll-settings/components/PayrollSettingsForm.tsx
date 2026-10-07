"use client";

import { type FormEvent, useState } from "react";

import { roleLabels, type UserRole } from "@/shared/auth/permissions";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { NumberInput } from "@/shared/components/NumberInput";

import { useUpdatePayrollSettings } from "../../hooks/usePayroll";
import type { PayrollSettings } from "../../types";

/** El rol `admin` nunca comisiona (§3): sus ventas no le pagan a nadie. */
const SELECTABLE_ELIGIBLE_ROLES: UserRole[] = ["vendedor", "almacen", "contador"];

type PayrollSettingsFormProps = {
  settings: PayrollSettings;
};

/** Mismo limite que el BFF (0 a 100) y mismo aviso que `PayrollEmployeeRow`. */
function getPercentError(text: string) {
  const value = Number(text);

  return Number.isFinite(value) && value >= 0 && value <= 100 ? undefined : "Entre 0 y 100.";
}

/**
 * El padre lo monta con `key={settings.updatedAt}`, asi que el estado inicial siempre
 * sale de la configuracion recien cargada (sin efectos de sincronizacion).
 */
export function PayrollSettingsForm({ settings }: PayrollSettingsFormProps) {
  const updateSettings = useUpdatePayrollSettings();
  const [defaultCommissionPct, setDefaultCommissionPct] = useState(
    String(settings.defaultCommissionPct),
  );
  const [warnSharePct, setWarnSharePct] = useState(
    String(settings.warnShareOfGrossProfitPct),
  );
  const [reinvestPct, setReinvestPct] = useState(String(settings.reinvestPct));
  const [reservePct, setReservePct] = useState(String(settings.reservePct));
  const [commissionSince, setCommissionSince] = useState(settings.commissionSince);
  const [eligibleRoles, setEligibleRoles] = useState<UserRole[]>(settings.eligibleRoles);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const defaultCommissionError = getPercentError(defaultCommissionPct);
  const warnShareError = getPercentError(warnSharePct);
  const reinvestError = getPercentError(reinvestPct);
  const reserveError = getPercentError(reservePct);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSavedAt(null);

    // Cada campo fuera de rango ya muestra su aviso: no se envia nada.
    if (defaultCommissionError || warnShareError || reinvestError || reserveError) {
      return;
    }

    try {
      await updateSettings.mutateAsync({
        commissionSince,
        defaultCommissionPct: Number(defaultCommissionPct),
        eligibleRoles,
        reinvestPct: Number(reinvestPct),
        reservePct: Number(reservePct),
        warnShareOfGrossProfitPct: Number(warnSharePct),
      });
      setSavedAt(new Date().toLocaleTimeString("es-VE"));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No pudimos guardar la configuracion.",
      );
    }
  }

  function toggleRole(role: UserRole, checked: boolean) {
    setEligibleRoles((current) =>
      checked ? [...new Set([...current, role])] : current.filter((value) => value !== role),
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          helperText="Las ventas anteriores a esta fecha no comisionan, ni siquiera como cobradas tarde. Protege a una tienda con historia de pagar todo su pasado en la primera quincena."
          label="Las comisiones cuentan desde"
          onChange={(event) => setCommissionSince(event.target.value)}
          type="date"
          value={commissionSince}
        />
        <NumberInput
          decimals={2}
          error={defaultCommissionError}
          helperText="Porcentaje que se usa para un cajero que aun no tiene uno propio."
          label="Comision por defecto (%)"
          onChange={(event) => setDefaultCommissionPct(event.target.value)}
          value={defaultCommissionPct}
        />
        <NumberInput
          decimals={2}
          error={warnShareError}
          helperText="Por encima de este porcentaje de la ganancia bruta el semaforo se pone en rojo."
          label="Umbral de alerta del semaforo (%)"
          onChange={(event) => setWarnSharePct(event.target.value)}
          value={warnSharePct}
        />
        <NumberInput
          decimals={2}
          error={reinvestError}
          helperText="Cuanto de lo que queda sugerimos reinvertir en mercancia. Solo informativo."
          label="Reinversion sugerida (%)"
          onChange={(event) => setReinvestPct(event.target.value)}
          value={reinvestPct}
        />
        <NumberInput
          decimals={2}
          error={reserveError}
          helperText="Cuanto de lo que queda sugerimos guardar como reserva. Solo informativo."
          label="Reserva sugerida (%)"
          onChange={(event) => setReservePct(event.target.value)}
          value={reservePct}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Roles elegibles</legend>
        <p className="text-sm text-on-surface-variant">
          Que roles pueden cobrar comision. El administrador nunca comisiona.
        </p>
        <div className="flex flex-wrap gap-4">
          {SELECTABLE_ELIGIBLE_ROLES.map((role) => (
            <label
              className="inline-flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant"
              key={role}
            >
              <input
                checked={eligibleRoles.includes(role)}
                className="h-4 w-4 rounded border-outline-variant accent-primary"
                onChange={(event) => toggleRole(role, event.target.checked)}
                type="checkbox"
              />
              {roleLabels[role]}
            </label>
          ))}
        </div>
      </fieldset>

      {errorMessage ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </p>
      ) : null}

      {savedAt ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Configuracion guardada a las {savedAt}.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={updateSettings.isPending} type="submit">
          {updateSettings.isPending ? "Guardando..." : "Guardar parametros"}
        </Button>
      </div>
    </form>
  );
}
