"use client";

import { Plus, RotateCcw, Save, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import { ErrorState } from "@/shared/components/ErrorState";
import { formatMarkupPct, MarginBadge } from "@/shared/components/MarginBadge";
import { NumberInput } from "@/shared/components/NumberInput";
import { useToast } from "@/shared/components/Toast";
import { formHelperClassName, formLabelClassName } from "@/shared/styles/form-controls";

import { type PricingSettings, useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  defaultPricingSettings,
  normalizePricingPct,
  PRICING_CHIP_RANGE_MESSAGE,
  PRICING_CHIPS_DUPLICATED_MESSAGE,
  PRICING_CHIPS_MAX,
  PRICING_PCT_MAX,
  PRICING_THRESHOLD_RANGE_MESSAGE,
  PRICING_THRESHOLDS_ORDER_MESSAGE,
} from "../../services/pricingSettings.schemas";

export const PRICING_THRESHOLDS_REQUIRED_MESSAGE = "Escribe los dos porcentajes del semáforo.";
export const PRICING_CHIPS_LIMIT_MESSAGE = `Ya hay ${PRICING_CHIPS_MAX} porcentajes: quita uno para añadir otro.`;
export const PRICING_CHIPS_MIN_MESSAGE = "Debe quedar al menos un porcentaje recomendado.";

const errorTextClassName = "min-w-0 text-sm text-destructive [overflow-wrap:anywhere]";

type PricingSettingsSectionProps = {
  /** Puede guardar ajustes (`users.manage`). Sin él la sección es de solo lectura. */
  canEdit: boolean;
};

type PricingDraft = {
  chipsPct: number[];
  greenFromPct: number | null;
  yellowFromPct: number | null;
};

function toDraft(pricing: PricingSettings): PricingDraft {
  return {
    chipsPct: [...pricing.chipsPct],
    greenFromPct: pricing.greenFromPct,
    yellowFromPct: pricing.yellowFromPct,
  };
}

function isSameDraft(first: PricingDraft, second: PricingDraft) {
  return (
    first.yellowFromPct === second.yellowFromPct &&
    first.greenFromPct === second.greenFromPct &&
    first.chipsPct.length === second.chipsPct.length &&
    first.chipsPct.every((chip, index) => chip === second.chipsPct[index])
  );
}

function isInThresholdRange(pct: number) {
  return pct >= 0 && pct <= PRICING_PCT_MAX;
}

/** Mismas reglas que el servidor (`pricingSettingsSchema`), para avisar antes de enviar. */
function getThresholdsError({ greenFromPct, yellowFromPct }: PricingDraft) {
  if (yellowFromPct === null || greenFromPct === null) {
    return PRICING_THRESHOLDS_REQUIRED_MESSAGE;
  }

  if (!isInThresholdRange(yellowFromPct) || !isInThresholdRange(greenFromPct)) {
    return PRICING_THRESHOLD_RANGE_MESSAGE;
  }

  return yellowFromPct < greenFromPct ? null : PRICING_THRESHOLDS_ORDER_MESSAGE;
}

/**
 * Pestaña "Precios" de Configuración: umbrales del semáforo de ganancia y % de
 * ganancia recomendados (los chips del bloque de precio). Nada se guarda hasta
 * pulsar "Guardar precios"; "Restablecer valores por defecto" solo rellena el
 * formulario.
 *
 * El semáforo es una alerta: no bloquea ventas ni cambia ningún precio.
 */
export function PricingSettingsSection({ canEdit }: PricingSettingsSectionProps) {
  const { showToast } = useToast();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const loaded = settings.data?.pricing;
  const [draft, setDraft] = useState<PricingDraft>(() => toDraft(defaultPricingSettings()));
  const [syncedPricing, setSyncedPricing] = useState<PricingSettings | null>(null);
  const [newChip, setNewChip] = useState<number | null>(null);
  const [chipError, setChipError] = useState<string | null>(null);
  // Candado propio: `isPending` llega con el siguiente render, tarde para un
  // segundo Enter o un clic en el mismo tick.
  const isSubmitInFlightRef = useRef(false);

  // Al cargar y tras cada guardado, el formulario se realinea con lo guardado.
  if (loaded && loaded !== syncedPricing) {
    setSyncedPricing(loaded);
    setDraft(toDraft(loaded));
    setNewChip(null);
    setChipError(null);
  }

  if (settings.isLoading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Cargando ajustes de precios...
      </p>
    );
  }

  if (settings.error || !loaded) {
    return (
      <ErrorState
        description={
          settings.error?.message ?? "No recibimos los ajustes de precios de la tienda."
        }
        onRetry={() => void settings.refetch()}
        title="No pudimos cargar los ajustes de precios"
      />
    );
  }

  const thresholdsError = getThresholdsError(draft);
  const isDirty = !isSameDraft(draft, toDraft(loaded));
  const isAtChipLimit = draft.chipsPct.length >= PRICING_CHIPS_MAX;
  const isPending = updateSettings.isPending;
  const isLocked = !canEdit || isPending;

  function updateDraft(patch: Partial<PricingDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function addChip() {
    if (newChip === null) {
      setChipError(PRICING_CHIP_RANGE_MESSAGE);

      return;
    }

    const pct = normalizePricingPct(newChip);

    if (pct <= 0 || pct > PRICING_PCT_MAX) {
      setChipError(PRICING_CHIP_RANGE_MESSAGE);
    } else if (draft.chipsPct.includes(pct)) {
      setChipError(PRICING_CHIPS_DUPLICATED_MESSAGE);
    } else if (isAtChipLimit) {
      setChipError(PRICING_CHIPS_LIMIT_MESSAGE);
    } else {
      updateDraft({ chipsPct: [...draft.chipsPct, pct].sort((first, second) => first - second) });
      setNewChip(null);
      setChipError(null);
    }
  }

  function removeChip(pct: number) {
    if (draft.chipsPct.length <= 1) {
      setChipError(PRICING_CHIPS_MIN_MESSAGE);

      return;
    }

    updateDraft({ chipsPct: draft.chipsPct.filter((chip) => chip !== pct) });
    setChipError(null);
  }

  // Enter en "Nuevo porcentaje" añade el chip: no debe guardar el formulario.
  function handleNewChipKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addChip();
    }
  }

  function resetToDefaults() {
    setDraft(toDraft(defaultPricingSettings()));
    setNewChip(null);
    setChipError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const { chipsPct, greenFromPct, yellowFromPct } = draft;

    if (
      !canEdit ||
      isSubmitInFlightRef.current ||
      thresholdsError ||
      yellowFromPct === null ||
      greenFromPct === null
    ) {
      return;
    }

    isSubmitInFlightRef.current = true;

    try {
      await updateSettings.mutateAsync({ pricing: { chipsPct, greenFromPct, yellowFromPct } });
      showToast({ title: "Ajustes de precios guardados", tone: "success" });
    } catch {
      // El motivo queda en `updateSettings.error` y se muestra junto al botón.
    } finally {
      isSubmitInFlightRef.current = false;
    }
  }

  return (
    <form className="space-y-4" noValidate onSubmit={(event) => void handleSubmit(event)}>
      <p className="text-sm text-on-surface-variant">
        La ganancia se calcula sobre el costo, que ya incluye el IVA. El semáforo es solo una
        alerta: no bloquea ventas ni cambia ningún precio.
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Semáforo de ganancia</CardTitle>
            <CardDescription>
              Rojo por debajo del primer porcentaje, amarillo entre los dos y verde desde el
              segundo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberInput
                decimals={2}
                disabled={isLocked}
                label="Rojo por debajo de (%)"
                onValueChange={(yellowFromPct) => updateDraft({ yellowFromPct })}
                value={draft.yellowFromPct}
              />
              <NumberInput
                decimals={2}
                disabled={isLocked}
                label="Verde desde (%)"
                onValueChange={(greenFromPct) => updateDraft({ greenFromPct })}
                value={draft.greenFromPct}
              />
            </div>
            {thresholdsError ? (
              <p className={errorTextClassName} role="alert">
                {thresholdsError}
              </p>
            ) : (
              <ThresholdsPreview
                greenFromPct={draft.greenFromPct ?? 0}
                yellowFromPct={draft.yellowFromPct ?? 0}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Porcentajes recomendados</CardTitle>
            <CardDescription>
              Los que se ofrecen al fijar un precio. De 1 a {PRICING_CHIPS_MAX}, sin repetir.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul aria-label="Porcentajes recomendados" className="flex flex-wrap gap-2">
              {draft.chipsPct.map((pct) => (
                <li
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface-container-lowest pl-3 pr-1 text-sm font-medium tabular-nums text-foreground"
                  key={pct}
                >
                  {formatMarkupPct(pct)}
                  {canEdit ? (
                    <button
                      aria-label={`Quitar ${formatMarkupPct(pct)}`}
                      className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isPending}
                      onClick={() => removeChip(pct)}
                      type="button"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 basis-40">
                  <NumberInput
                    decimals={2}
                    disabled={isPending}
                    label="Nuevo porcentaje (%)"
                    onKeyDown={handleNewChipKeyDown}
                    onValueChange={(value) => {
                      setNewChip(value);
                      setChipError(null);
                    }}
                    value={newChip}
                  />
                </div>
                <Button
                  className="gap-2"
                  disabled={isPending}
                  onClick={addChip}
                  type="button"
                  variant="secondary"
                >
                  <Plus aria-hidden className="size-4" />
                  Añadir
                </Button>
              </div>
            ) : null}
            {chipError ? (
              <p className={errorTextClassName} role="alert">
                {chipError}
              </p>
            ) : isAtChipLimit && canEdit ? (
              <p className={formHelperClassName}>{PRICING_CHIPS_LIMIT_MESSAGE}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {canEdit ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            className="gap-2"
            disabled={!isDirty || isPending || thresholdsError !== null}
            type="submit"
          >
            <Save aria-hidden className="size-4" />
            {isPending ? "Guardando..." : "Guardar precios"}
          </Button>
          <Button
            className="gap-2"
            disabled={isPending}
            onClick={resetToDefaults}
            type="button"
            variant="secondary"
          >
            <RotateCcw aria-hidden className="size-4" />
            Restablecer valores por defecto
          </Button>
          {isDirty ? (
            <span className={formHelperClassName}>Hay cambios sin guardar.</span>
          ) : null}
        </div>
      ) : (
        <p className={formHelperClassName}>Solo un administrador puede cambiar estos valores.</p>
      )}

      {updateSettings.error ? (
        <p className={errorTextClassName} role="alert">
          {updateSettings.error.message}
        </p>
      ) : null}
    </form>
  );
}

/** Un % de ejemplo de cada banda con los umbrales que se están editando. */
function ThresholdsPreview({ greenFromPct, yellowFromPct }: Omit<PricingSettings, "chipsPct">) {
  const thresholds = { high: greenFromPct, low: yellowFromPct };
  const examples = [
    // Con el rojo en 0 % solo es roja una venta por debajo del costo.
    normalizePricingPct(yellowFromPct > 0 ? yellowFromPct / 2 : -5),
    normalizePricingPct((yellowFromPct + greenFromPct) / 2),
    greenFromPct,
  ];

  return (
    <div className="space-y-2">
      <p className={formLabelClassName}>Vista previa</p>
      <div aria-label="Vista previa del semáforo" className="flex flex-wrap gap-2" role="group">
        {examples.map((pct, index) => (
          <MarginBadge key={index} pct={pct} size="md" thresholds={thresholds} />
        ))}
      </div>
      <p className={formHelperClassName}>
        Amarillo desde {formatMarkupPct(yellowFromPct)} y por debajo de{" "}
        {formatMarkupPct(greenFromPct)}.
      </p>
    </div>
  );
}
