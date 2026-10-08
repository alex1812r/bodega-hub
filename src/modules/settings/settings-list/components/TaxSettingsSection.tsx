"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { ErrorState } from "@/shared/components/ErrorState";
import { formatTaxRatePct, TaxRateChips } from "@/shared/components/TaxRateChips";
import { useToast } from "@/shared/components/Toast";
import { type TaxRate, useTaxRates } from "@/shared/hooks/useTaxRates";
import { formHelperClassName, formLabelClassName } from "@/shared/styles/form-controls";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useUpdateTaxRate } from "../../hooks/useTaxRatesAdmin";
import { TaxRateCreateModal } from "./TaxRateCreateModal";

const errorTextClassName = "min-w-0 text-sm text-destructive [overflow-wrap:anywhere]";

type TaxSettingsSectionProps = {
  /** Puede guardar ajustes (`users.manage`). Sin él la sección es de solo lectura. */
  canEdit: boolean;
};

function describeRate(rate: TaxRate) {
  return `${rate.label} (${formatTaxRatePct(rate.pct)})`;
}

/**
 * Pestaña "Impuestos" de Configuración: catálogo de alícuotas de IVA de la
 * tienda (añadir, activar y desactivar) y alícuota por defecto para las
 * categorías nuevas (`defaultTaxRateId`).
 *
 * El IVA no se teclea en ningún otro sitio: el único % que se escribe es el de
 * una alícuota nueva, al definirla. La alícuota por defecto se elige del
 * catálogo y se guarda al elegirla.
 */
export function TaxSettingsSection({ canEdit }: TaxSettingsSectionProps) {
  const { showToast } = useToast();
  const { error, isLoading, rates, refetch } = useTaxRates({ activeOnly: false });
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const updateTaxRate = useUpdateTaxRate();
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivating, setDeactivating] = useState<TaxRate | null>(null);
  // Candado propio: `isPending` llega con el siguiente render, tarde para un segundo clic.
  const isChangeInFlightRef = useRef(false);

  const defaultRate =
    rates.find((rate) => rate.id === settings.data?.defaultTaxRateId) ??
    rates.find((rate) => rate.isDefault) ??
    null;
  const isBusy = updateTaxRate.isPending || updateSettings.isPending;

  async function changeDefaultRate(rate: TaxRate) {
    if (isChangeInFlightRef.current) {
      return;
    }

    isChangeInFlightRef.current = true;

    try {
      await updateSettings.mutateAsync({ defaultTaxRateId: rate.id });
      await refetch();
      showToast({
        title: `Alícuota por defecto: ${describeRate(rate)}`,
        tone: "success",
      });
    } catch {
      // El motivo queda en `updateSettings.error` y se muestra bajo el selector.
    } finally {
      isChangeInFlightRef.current = false;
    }
  }

  async function setRateActive(rate: TaxRate, isActive: boolean) {
    if (isChangeInFlightRef.current) {
      return;
    }

    isChangeInFlightRef.current = true;

    try {
      await updateTaxRate.mutateAsync({ id: rate.id, isActive });
      setDeactivating(null);
      showToast({
        title: `Alícuota ${isActive ? "activada" : "desactivada"}: ${describeRate(rate)}`,
        tone: "success",
      });
    } catch {
      // El motivo queda en `updateTaxRate.error`: en el diálogo al desactivar, sobre la lista al activar.
    } finally {
      isChangeInFlightRef.current = false;
    }
  }

  function openDeactivate(rate: TaxRate) {
    updateTaxRate.reset();
    setDeactivating(rate);
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <Card>
        <CardHeader>
          <CardTitle>Alícuotas de IVA</CardTitle>
          <CardDescription>
            Catálogo del que se elige el impuesto de cada categoría y de cada línea de compra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit ? (
            <Button
              className="w-full gap-2 sm:w-auto"
              onClick={() => setCreateOpen(true)}
              size="sm"
              type="button"
            >
              <Plus aria-hidden className="size-4" />
              Añadir alícuota
            </Button>
          ) : (
            <p className={formHelperClassName}>
              Solo un administrador puede añadir, activar o desactivar alícuotas.
            </p>
          )}

          {updateTaxRate.error && !deactivating ? (
            <p className={errorTextClassName} role="alert">
              {updateTaxRate.error.message}
            </p>
          ) : null}

          {isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Cargando alícuotas...
            </p>
          ) : error ? (
            <ErrorState
              description={error.message}
              onRetry={() => void refetch()}
              title="No pudimos cargar las alícuotas"
            />
          ) : rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay alícuotas en el catálogo.</p>
          ) : (
            <ul
              aria-label="Alícuotas de IVA"
              className="divide-y divide-border rounded-lg border border-border"
            >
              {rates.map((rate) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3"
                  key={rate.id}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                      {rate.label}
                    </span>
                    <span className="text-sm tabular-nums text-on-surface-variant">
                      {formatTaxRatePct(rate.pct)}
                    </span>
                    <Badge variant={rate.isActive ? "success" : "default"}>
                      {rate.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                    <Badge variant="default">{rate.isGlobal ? "Global" : "De la tienda"}</Badge>
                    {rate.id === defaultRate?.id ? <Badge variant="info">Por defecto</Badge> : null}
                  </div>
                  {canEdit ? (
                    <Button
                      aria-label={`${rate.isActive ? "Desactivar" : "Activar"} ${describeRate(rate)}`}
                      disabled={isBusy}
                      onClick={() =>
                        rate.isActive ? openDeactivate(rate) : void setRateActive(rate, true)
                      }
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {rate.isActive ? "Desactivar" : "Activar"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alícuota por defecto</CardTitle>
          <CardDescription>
            Con la que abre una categoría nueva. Cada categoría puede elegir otra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className={formLabelClassName}>Alícuota por defecto para categorías nuevas</p>
          {settings.error ? (
            <p className={errorTextClassName} role="alert">
              {settings.error.message}
            </p>
          ) : error ? (
            // El motivo y "Reintentar" ya están en la lista: aquí no se repiten.
            <p className="text-sm text-muted-foreground">
              No se puede elegir hasta que cargue el catálogo de alícuotas.
            </p>
          ) : (
            <TaxRateChips
              disabled={!canEdit || isBusy || settings.isLoading}
              isLoading={isLoading || settings.isLoading}
              label="Alícuota por defecto para categorías nuevas"
              onChange={(_code, rate) => void changeDefaultRate(rate)}
              rates={rates}
              size="md"
              value={defaultRate?.code ?? null}
              valuePct={defaultRate?.pct}
            />
          )}
          <p className={formHelperClassName}>
            {canEdit
              ? "Se guarda al elegirla. No cambia las categorías que ya existen."
              : "Solo un administrador puede cambiarla."}
          </p>
          {updateSettings.error ? (
            <p className={errorTextClassName} role="alert">
              {updateSettings.error.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {createOpen ? <TaxRateCreateModal onOpenChange={setCreateOpen} /> : null}

      {deactivating ? (
        <ConfirmActionModal
          confirmLabel="Desactivar alícuota"
          description={`Vas a desactivar ${describeRate(deactivating)}. Las categorías que la usan la conservan; no se podrá elegir en nuevas.`}
          error={updateTaxRate.error?.message}
          isPending={updateTaxRate.isPending}
          onConfirm={() => setRateActive(deactivating, false)}
          onOpenChange={(open) => {
            if (!open) {
              // El rechazo ya se leyó en el diálogo: no debe quedar sobre la lista.
              updateTaxRate.reset();
              setDeactivating(null);
            }
          }}
          open
          title="¿Desactivar esta alícuota?"
          variant="danger"
        />
      ) : null}
    </div>
  );
}
