"use client";

import { Button } from "@/shared/components/Button";
import { NumberInput, parseNumberInput } from "@/shared/components/NumberInput";

import {
  buildDefaultPackDistribution,
  checkPackDistribution,
  type PackDistributionComponent,
  type PackDistributionValue,
  parsePackDistribution,
} from "../utils/packDistribution";
import { computePackOpeningEffect } from "../utils/packOpeningEffect";

/** Un componente de la receta tal como lo pinta el control. */
export type PackDistributionFieldComponent = PackDistributionComponent & {
  /** Stock actual del componente; si se pasa, se muestra bajo el nombre. */
  currentStock?: number;
  /** `false` = producto inactivo: recibe las unidades igualmente y el control lo avisa. */
  isActive?: boolean;
  name: string;
  sku?: string;
};

type PackDistributionFieldsProps = {
  /** Componentes de la receta del empaque, en el orden en que se pintan. */
  components: readonly PackDistributionFieldComponent[];
  disabled?: boolean;
  /** Título del grupo de campos. */
  legend?: string;
  /** Texto nuevo de todos los campos tocados; `{}` = volver a la receta. */
  onChange: (value: PackDistributionValue) => void;
  /** Empaques que se abren: el reparto debe sumar `unidades por empaque × empaques`. */
  packQuantity: number;
  /** Texto de cada campo por id de componente; sin entrada, lo que dice la receta. */
  value: PackDistributionValue;
};

function describeInactive(names: string[]) {
  return names.length === 1
    ? `${names[0]} está inactivo: recibirá stock, pero no se podrá vender hasta activarlo.`
    : `${names.join(", ")} están inactivos: recibirán stock, pero no se podrán vender hasta activarlos.`;
}

function describeSecondary(component: PackDistributionFieldComponent) {
  return [
    component.sku,
    component.currentStock === undefined ? undefined : `Stock actual ${component.currentStock}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Reparto editable de la apertura de un empaque surtido: una fila por componente
 * de la receta con sus unidades, la suma contra el total (`unidades por empaque ×
 * empaques`) y «Restablecer receta». Controlado: no guarda estado ni envía nada.
 *
 * Abre con el reparto de la receta; quien lo usa decide con
 * `checkPackDistribution(components, packQuantity, parsePackDistribution(...))`
 * si el reparto se puede enviar: es la misma comprobación (y el mismo mensaje)
 * que muestra el control cuando la suma no cuadra o una cantidad no es un entero ≥ 0.
 */
export function PackDistributionFields({
  components,
  disabled = false,
  legend = "Reparto de unidades",
  onChange,
  packQuantity,
  value,
}: PackDistributionFieldsProps) {
  const defaults = buildDefaultPackDistribution(components, packQuantity);
  const check = checkPackDistribution(
    components,
    packQuantity,
    parsePackDistribution(components, packQuantity, value),
  );
  const inactiveNames = components
    .filter(
      (component) =>
        component.isActive === false && (check.units[component.unitProductId] ?? 0) > 0,
    )
    .map((component) => component.name);
  // Lo que muestra cada campo: lo tecleado o, si no se tocó, lo de la receta.
  const texts = Object.fromEntries(
    components.map((component) => [
      component.unitProductId,
      value[component.unitProductId] ?? String(defaults[component.unitProductId] ?? 0),
    ]),
  );

  // Lo que se pinta (repartido de total) sale del efecto de la apertura de
  // Inventario: un decimal a medio teclear cuenta en la suma; que no valga lo
  // dice `check` (y el propio campo).
  const effect = computePackOpeningEffect({
    distribution: Object.fromEntries(
      components.map((component) => [
        component.unitProductId,
        parseNumberInput(texts[component.unitProductId] ?? "") ?? 0,
      ]),
    ),
    packQuantity,
    recipe: {
      components: components.map((component) => ({
        currentStock: component.currentStock ?? 0,
        isActive: component.isActive !== false,
        name: component.name,
        sku: component.sku ?? "",
        unitProductId: component.unitProductId,
        unitsPerPack: component.unitsPerPack,
      })),
      pack: { currentStock: packQuantity, name: "" },
    },
  });

  return (
    <fieldset className="grid min-w-0 gap-3 rounded-lg border border-outline-variant/30 p-3">
      <legend className="px-1 text-sm font-medium text-on-surface">{legend}</legend>
      <ul className="grid gap-3">
        {components.map((component) => {
          const secondary = describeSecondary(component);

          return (
            <li
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-start"
              key={component.unitProductId}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-on-surface [overflow-wrap:anywhere]">
                  {component.name}
                  {component.isActive === false ? " (inactivo)" : null}
                </p>
                {secondary ? (
                  <p className="text-xs text-on-surface-variant [overflow-wrap:anywhere]">
                    {secondary}
                  </p>
                ) : null}
              </div>
              <NumberInput
                aria-label={`Unidades de ${component.name}`}
                decimals={0}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...texts, [component.unitProductId]: event.target.value })
                }
                value={texts[component.unitProductId] ?? ""}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium tabular-nums text-on-surface">
          {effect.distributedTotal} de {effect.expectedTotal} unidades
        </p>
        <Button
          disabled={disabled || !check.isAdjusted}
          onClick={() => onChange({})}
          size="sm"
          type="button"
          variant="outline"
        >
          Restablecer receta
        </Button>
      </div>
      {/* Región viva sin `alert`: se anuncia al dejar de teclear, sin interrumpir. */}
      <div aria-live="polite">
        {check.message ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {check.message}
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
