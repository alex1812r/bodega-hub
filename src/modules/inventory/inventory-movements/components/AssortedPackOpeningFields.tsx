"use client";

import { Button } from "@/shared/components/Button";
import { NumberInput } from "@/shared/components/NumberInput";

import type { AssortedPackOpening } from "../hooks/useAssortedPackOpening";

type AssortedPackOpeningFieldsProps = {
  opening: AssortedPackOpening;
};

function describeMismatch(difference: number, expectedTotal: number) {
  return difference < 0
    ? `Faltan ${-difference} unidad(es) por repartir: el reparto debe sumar ${expectedTotal}.`
    : `Sobran ${difference} unidad(es): el reparto debe sumar ${expectedTotal}.`;
}

function describeInactive(names: string[]) {
  return names.length === 1
    ? `${names[0]} está inactivo: recibirá stock, pero no se podrá vender hasta activarlo.`
    : `${names.join(", ")} están inactivos: recibirán stock, pero no se podrán vender hasta activarlos.`;
}

/**
 * Reparto editable de la apertura de un surtido: una fila por componente con
 * sus unidades, la suma contra el total y "Restablecer receta". No pinta nada
 * mientras no haya un surtido elegido y una cantidad de empaques válida.
 */
export function AssortedPackOpeningFields({ opening }: AssortedPackOpeningFieldsProps) {
  const { effect } = opening;

  if (!effect || !opening.showsDistribution) {
    return null;
  }

  const inactiveNames = effect.components
    .filter((component) => !component.isActive && component.units > 0)
    .map((component) => component.name);

  return (
    <fieldset className="grid min-w-0 gap-3 rounded-lg border border-outline-variant/30 p-3">
      <legend className="px-1 text-sm font-medium text-on-surface">Reparto de unidades</legend>
      <ul className="grid gap-3">
        {effect.components.map((component) => (
          <li
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-start"
            key={component.unitProductId}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-on-surface [overflow-wrap:anywhere]">
                {component.name}
                {component.isActive ? null : " (inactivo)"}
              </p>
              <p className="text-xs text-on-surface-variant [overflow-wrap:anywhere]">
                {component.sku} · Stock actual {component.stockBefore}
              </p>
            </div>
            <NumberInput
              aria-label={`Unidades de ${component.name}`}
              decimals={0}
              onChange={(event) => opening.setUnits(component.unitProductId, event.target.value)}
              value={opening.values[component.unitProductId] ?? ""}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium tabular-nums text-on-surface">
          {effect.distributedTotal} de {effect.expectedTotal} unidades
        </p>
        <Button onClick={opening.resetDistribution} size="sm" type="button" variant="outline">
          Restablecer receta
        </Button>
      </div>
      {/* Región viva sin `alert`: se anuncia al dejar de teclear, sin interrumpir. */}
      <div aria-live="polite">
        {effect.difference !== 0 ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {describeMismatch(effect.difference, effect.expectedTotal)}
          </p>
        ) : null}
      </div>
      {inactiveNames.length > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {describeInactive(inactiveNames)}
        </p>
      ) : null}
    </fieldset>
  );
}

type AssortedPackOpeningActionsProps = {
  formId: string;
  onCancel: () => void;
  opening: AssortedPackOpening;
};

/** Pie del formulario de un surtido: "Continuar" lleva a la confirmación y se apaga si el reparto no cuadra. */
export function AssortedPackOpeningActions({
  formId,
  onCancel,
  opening,
}: AssortedPackOpeningActionsProps) {
  return (
    <>
      <Button onClick={onCancel} type="button" variant="outline">
        Cancelar
      </Button>
      <Button disabled={opening.hasDistributionIssue} form={formId} type="submit">
        Continuar
      </Button>
    </>
  );
}
