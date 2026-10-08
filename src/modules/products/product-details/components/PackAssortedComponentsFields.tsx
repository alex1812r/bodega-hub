"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/shared/components/Button";
import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { EntityAutocomplete } from "@/shared/components/EntityAutocomplete";
import { IconButton } from "@/shared/components/IconButton";
import { Input } from "@/shared/components/Input";
import {
  getNumberInputError,
  NumberInput,
  parseNumberInput,
} from "@/shared/components/NumberInput";
import { cn } from "@/shared/utils/cn";

import {
  ASSORTED_PACK_MAX_COMPONENTS,
  ASSORTED_PACK_MIN_COMPONENTS,
  PACK_RECIPE_LABEL_MAX_LENGTH,
} from "../../services/packConversionSchemas";
import { createUnitCandidatesFetcher, isBlockedByPackLink } from "./packUnitCandidates";

/** Un producto que sale del empaque surtido, tal como se edita en el formulario. */
export type PackComponentFormRow = {
  /** Texto del campo; vacío vale 1. */
  costWeight: string;
  /** El producto guardado en la receta está inactivo: se avisa, no bloquea. */
  isInactive: boolean;
  /** Identidad de la fila en el formulario (no viaja al servidor). */
  key: string;
  unitName: string;
  unitProductId: string;
  unitsPerPack: string;
};

type PackComponentRowErrors = { product?: string; units?: string; weight?: string };

export type AssortedPackErrors = {
  /** Menos de 2 productos. */
  components?: string;
  rows: Record<string, PackComponentRowErrors>;
  /** La suma de las filas no es el total declarado. */
  total?: string;
};

type AssortedPackValues = { components: PackComponentFormRow[]; unitsPerPack: string };

const DEFAULT_COST_WEIGHT = 1;
const UNKNOWN_COMPONENT_LABEL = "Producto seleccionado";
const IS_PACK_REASON = "Es un empaque con receta activa: no puede salir de otro empaque.";
const ALREADY_IN_RECIPE_REASON = "Ya está en otra fila de este empaque.";
const COST_WEIGHT_HELP = "Reparte el costo del empaque; 2 = el doble por unidad que los de peso 1";

// Un producto que ya sale de otro empaque sí puede ser componente; un empaque no.
const fetchComponentCandidates = createUnitCandidatesFetcher("not-pack");

let rowSequence = 0;

export function createPackComponentRow(
  values: Partial<Omit<PackComponentFormRow, "key">> = {},
): PackComponentFormRow {
  rowSequence += 1;

  return {
    costWeight: String(DEFAULT_COST_WEIGHT),
    isInactive: false,
    key: `pack-component-${rowSequence}`,
    unitName: "",
    unitProductId: "",
    unitsPerPack: "",
    ...values,
  };
}

/** Peso de costo de la fila: vacío = 1; `null` si lo escrito no vale (debe ser > 0). */
export function getPackComponentCostWeight(text: string) {
  if (text.trim() === "") {
    return DEFAULT_COST_WEIGHT;
  }

  const weight = parseNumberInput(text);

  return weight !== null && weight > 0 ? weight : null;
}

function getComponentUnitsError(text: string) {
  return (
    getNumberInputError(text, { decimals: 0 }) ??
    (Number(text) >= 1 ? undefined : "Indica las unidades (mínimo 1).")
  );
}

function getDeclaredTotal(text: string) {
  const total = Number(text);

  return text.trim() !== "" && Number.isInteger(total) && total > 0 ? total : null;
}

/** Suma de las unidades de las filas; una fila sin unidades válidas cuenta 0. */
export function getPackComponentsUnitsSum(components: PackComponentFormRow[]) {
  return components.reduce(
    (sum, row) => sum + (getComponentUnitsError(row.unitsPerPack) ? 0 : Number(row.unitsPerPack)),
    0,
  );
}

/**
 * Avisos del surtido, o `undefined` si se puede enviar. Mismas reglas que
 * `packConversionInputSchema`, que es quien responde 400 si esto se envía. El
 * total declarado ("Unidades por empaque") lo valida `getUnitsPerPackError`.
 */
export function getAssortedPackErrors({
  components,
  unitsPerPack,
}: AssortedPackValues): AssortedPackErrors | undefined {
  const rows: Record<string, PackComponentRowErrors> = {};
  const seenProductIds = new Set<string>();

  components.forEach((row) => {
    const errors: PackComponentRowErrors = {};

    if (!row.unitProductId) {
      errors.product = "Elige un producto o quita la fila.";
    } else if (seenProductIds.has(row.unitProductId)) {
      errors.product = "Este producto ya está en otra fila.";
    }

    seenProductIds.add(row.unitProductId);

    const unitsError = getComponentUnitsError(row.unitsPerPack);

    if (unitsError) {
      errors.units = unitsError;
    }

    if (getPackComponentCostWeight(row.costWeight) === null) {
      errors.weight = "El peso debe ser mayor que 0.";
    }

    if (Object.keys(errors).length > 0) {
      rows[row.key] = errors;
    }
  });

  const componentsError =
    components.length < ASSORTED_PACK_MIN_COMPONENTS
      ? `Un empaque surtido lleva al menos ${ASSORTED_PACK_MIN_COMPONENTS} productos.`
      : undefined;
  const hasRowErrors = Object.keys(rows).length > 0;
  const declared = getDeclaredTotal(unitsPerPack);
  const sum = getPackComponentsUnitsSum(components);
  // Con filas a medias la suma no dice nada todavía: primero se corrigen ellas.
  const totalError =
    !hasRowErrors && !componentsError && declared !== null && sum !== declared
      ? `Los productos suman ${sum} unidades y el empaque declara ${declared}.`
      : undefined;

  return hasRowErrors || componentsError || totalError
    ? { components: componentsError, rows, total: totalError }
    : undefined;
}

/** "Suma: 5 de 6 unidades — faltan 1" / "sobran 2" / "✓ 6 de 6 unidades". */
export function getPackComponentsSumText({ components, unitsPerPack }: AssortedPackValues) {
  const declared = getDeclaredTotal(unitsPerPack);
  const sum = getPackComponentsUnitsSum(components);

  if (declared === null) {
    return { matches: false, text: `Suma: ${sum} unidades` };
  }

  if (sum === declared) {
    return { matches: true, text: `✓ ${sum} de ${declared} unidades` };
  }

  return {
    matches: false,
    text:
      sum < declared
        ? `Suma: ${sum} de ${declared} unidades — faltan ${declared - sum}`
        : `Suma: ${sum} de ${declared} unidades — sobran ${sum - declared}`,
  };
}

/**
 * Añade un producto recién creado a la receta: ocupa la primera fila sin
 * producto o, si no hay, una fila nueva. Devuelve la clave de esa fila.
 */
export function addProductToPackComponents(
  components: PackComponentFormRow[],
  product: { id: string; isActive: boolean; name: string },
) {
  const values = {
    isInactive: !product.isActive,
    unitName: product.name,
    unitProductId: product.id,
  };
  const emptyRow = components.find((row) => !row.unitProductId);

  if (emptyRow) {
    return {
      components: components.map((row) => (row === emptyRow ? { ...row, ...values } : row)),
      rowKey: emptyRow.key,
    };
  }

  const row = createPackComponentRow(values);

  return { components: [...components, row], rowKey: row.key };
}

function findRowField(container: ParentNode, attribute: string, rowKey: string) {
  return container.querySelector<HTMLInputElement>(`[${attribute}="${rowKey}"] input`);
}

/** El campo "Unidades" de una fila, para llevarle el foco. */
export function findPackComponentUnitsField(container: ParentNode, rowKey: string) {
  return findRowField(container, "data-pack-component-units", rowKey);
}

/**
 * Primer campo del surtido que no vale, en el orden en que se ven: producto y
 * unidades de cada fila, "Añadir producto" si faltan filas, los pesos de
 * "Avanzado" y, si solo falla la suma, el total declarado.
 */
export function findAssortedInvalidField(
  container: ParentNode,
  errors: AssortedPackErrors,
  components: PackComponentFormRow[],
  totalFieldName: string,
): HTMLElement | null {
  for (const row of components) {
    const rowErrors = errors.rows[row.key];

    if (rowErrors?.product) {
      return findRowField(container, "data-pack-component-product", row.key);
    }

    if (rowErrors?.units) {
      return findPackComponentUnitsField(container, row.key);
    }
  }

  if (errors.components) {
    return container.querySelector<HTMLButtonElement>("[data-pack-component-add]");
  }

  const weightRow = components.find((row) => errors.rows[row.key]?.weight);

  if (weightRow) {
    return findRowField(container, "data-pack-component-weight", weightRow.key);
  }

  return container.querySelector<HTMLInputElement>(`input[name="${totalFieldName}"]`);
}

type PackAssortedComponentsFieldsProps = {
  components: PackComponentFormRow[];
  excludeProductId?: string;
  label: string;
  onChange: (patch: { assortedLabel?: string; components?: PackComponentFormRow[] }) => void;
  /**
   * Abre el alta rápida de un producto para añadirlo como componente. Recibe el
   * botón pulsado, para devolverle el foco al cerrar. Sin ella no hay botón.
   */
  onCreateUnitProduct?: (trigger: HTMLButtonElement) => void;
  /** Al cambiar, los buscadores olvidan las búsquedas ya respondidas. */
  searchResetKey?: number | string;
  /** Tras intentar enviar: muestra los avisos de las filas. */
  showErrors: boolean;
  /** Texto de "Unidades por empaque": el total declarado. */
  unitsPerPack: string;
};

/**
 * Receta de un empaque surtido: nombre opcional, productos que salen con sus
 * unidades, suma contra el total declarado y, en "Avanzado", el peso de costo.
 */
export function PackAssortedComponentsFields({
  components,
  excludeProductId,
  label,
  onChange,
  onCreateUnitProduct,
  searchResetKey,
  showErrors,
  unitsPerPack,
}: PackAssortedComponentsFieldsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const errors = showErrors ? getAssortedPackErrors({ components, unitsPerPack }) : undefined;
  const sum = getPackComponentsSumText({ components, unitsPerPack });
  const isFull = components.length >= ASSORTED_PACK_MAX_COMPONENTS;
  const hasEmptyRow = components.some((row) => !row.unitProductId);
  const hasWeightError = components.some((row) => errors?.rows[row.key]?.weight);
  const customWeights = components.filter(
    (row) => getPackComponentCostWeight(row.costWeight) !== DEFAULT_COST_WEIGHT,
  ).length;

  function patchRow(rowKey: string, patch: Partial<PackComponentFormRow>) {
    onChange({
      components: components.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)),
    });
  }

  function addRow() {
    const row = createPackComponentRow();

    flushSync(() => onChange({ components: [...components, row] }));

    if (rootRef.current) {
      findRowField(rootRef.current, "data-pack-component-product", row.key)?.focus();
    }
  }

  function removeRow(rowKey: string) {
    flushSync(() => onChange({ components: components.filter((row) => row.key !== rowKey) }));
    rootRef.current?.querySelector<HTMLButtonElement>("[data-pack-component-add]")?.focus();
  }

  return (
    <div className="grid min-w-0 gap-3" ref={rootRef}>
      <Input
        helperText="Opcional. Para reconocer la receta, p. ej. «Sabores surtidos»."
        label="Nombre del surtido"
        maxLength={PACK_RECIPE_LABEL_MAX_LENGTH}
        onChange={(event) => onChange({ assortedLabel: event.target.value })}
        value={label}
      />

      <ul className="grid gap-3">
        {components.map((row, index) => {
          const position = index + 1;
          const rowErrors = errors?.rows[row.key];
          const otherProductIds = components
            .filter((other) => other.key !== row.key && other.unitProductId)
            .map((other) => other.unitProductId);

          return (
            <li
              className="grid min-w-0 gap-3 rounded-lg border border-outline-variant/40 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-start"
              key={row.key}
            >
              <div className="min-w-0" data-pack-component-product={row.key}>
                <EntityAutocomplete
                  entity="product"
                  error={rowErrors?.product}
                  fetcher={fetchComponentCandidates}
                  filters={{ active: true, excludeIds: excludeProductId ? [excludeProductId] : [] }}
                  getOptionDisabled={(option) =>
                    otherProductIds.includes(option.id)
                      ? ALREADY_IN_RECIPE_REASON
                      : isBlockedByPackLink(option) && IS_PACK_REASON
                  }
                  helperText={
                    row.isInactive
                      ? "Inactivo: el empaque se puede guardar y vender igual."
                      : undefined
                  }
                  key={searchResetKey}
                  label={`Producto ${position}`}
                  onChange={(option) =>
                    patchRow(row.key, {
                      isInactive: option ? !option.isActive : false,
                      unitName: option?.label ?? "",
                      unitProductId: option?.id ?? "",
                    })
                  }
                  // Sin recientes: una copia del navegador puede ser ya un empaque
                  // y se ofrecería habilitada y sin motivo.
                  recentsKey={null}
                  value={
                    row.unitProductId
                      ? { id: row.unitProductId, label: row.unitName || UNKNOWN_COMPONENT_LABEL }
                      : null
                  }
                />
              </div>
              <div className="min-w-0" data-pack-component-units={row.key}>
                <NumberInput
                  decimals={0}
                  error={rowErrors?.units}
                  label={`Unidades del producto ${position}`}
                  onChange={(event) => patchRow(row.key, { unitsPerPack: event.target.value })}
                  value={row.unitsPerPack}
                />
              </div>
              <IconButton
                aria-label={`Quitar producto ${position}`}
                className="justify-self-end sm:mt-7"
                icon={<Trash2 aria-hidden="true" className="size-4" />}
                onClick={() => removeRow(row.key)}
                variant="outline"
              />
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-pack-component-add=""
          disabled={isFull}
          onClick={addRow}
          size="sm"
          variant="outline"
        >
          <Plus aria-hidden="true" className="size-4" />
          Añadir producto
        </Button>
        {onCreateUnitProduct ? (
          <Button
            disabled={isFull && !hasEmptyRow}
            onClick={(event) => onCreateUnitProduct(event.currentTarget)}
            size="sm"
            variant="outline"
          >
            Crear producto unidad
          </Button>
        ) : null}
        {isFull ? (
          <span className="text-xs text-on-surface-variant">
            Máximo {ASSORTED_PACK_MAX_COMPONENTS} productos.
          </span>
        ) : null}
      </div>
      {errors?.components ? (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {errors.components}
        </p>
      ) : null}

      <p
        aria-live="polite"
        className={cn(
          "rounded-md px-3 py-2 text-sm font-medium [overflow-wrap:anywhere]",
          sum.matches
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
        )}
        data-pack-components-sum=""
      >
        {sum.text}
      </p>

      <CollapsibleSection
        className="min-w-0"
        // Un peso que no vale no puede quedar escondido: la sección se abre sola.
        open={hasWeightError ? true : undefined}
        summary={
          customWeights > 0
            ? `Peso de costo propio en ${customWeights} producto(s)`
            : "Peso de costo: todos iguales"
        }
        title="Avanzado"
      >
        <div className="grid gap-3">
          <p className="text-xs text-on-surface-variant">{COST_WEIGHT_HELP}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {components.map((row, index) => (
              <div className="min-w-0" data-pack-component-weight={row.key} key={row.key}>
                <NumberInput
                  decimals={2}
                  error={errors?.rows[row.key]?.weight}
                  label={`Peso de costo de ${row.unitName || `producto ${index + 1}`}`}
                  onChange={(event) => patchRow(row.key, { costWeight: event.target.value })}
                  placeholder={String(DEFAULT_COST_WEIGHT)}
                  value={row.costWeight}
                />
              </div>
            ))}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
