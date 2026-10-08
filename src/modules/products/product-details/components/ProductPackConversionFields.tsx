"use client";

import { type FormEvent, useState } from "react";

import {
  EntityAutocomplete,
  type EntityAutocompleteValue,
} from "@/shared/components/EntityAutocomplete";
import { Input } from "@/shared/components/Input";
import { getNumberInputError, NumberInput } from "@/shared/components/NumberInput";
import { SelectField } from "@/shared/components/SelectField";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import {
  createPackComponentRow,
  getAssortedPackErrors,
  getPackComponentCostWeight,
  PackAssortedComponentsFields,
  type PackComponentFormRow,
} from "./PackAssortedComponentsFields";
import { createUnitCandidatesFetcher, isBlockedByPackLink } from "./packUnitCandidates";

export type PackConversionMode = "assorted" | "create_unit" | "link_existing";

export type PackConversionFormState = {
  /**
   * «Desarmar siempre al recibir compras» (COM-14). `undefined` = el usuario no
   * tocó la casilla: se muestra la preferencia guardada y no viaja al guardar.
   */
  alwaysDisassembleOnReceive?: boolean;
  /** Modo surtido: nombre opcional de la receta. */
  assortedLabel: string;
  /** Modo surtido: productos que salen del empaque. */
  components: PackComponentFormRow[];
  enabled: boolean;
  mode: PackConversionMode;
  unitBarcode: string;
  unitName: string;
  unitProductId: string;
  unitSalePriceRef: string;
  unitSku: string;
  /** Unidades que salen del empaque; en modo surtido, el total declarado. */
  unitsPerPack: string;
};

type ProductPackConversionFieldsProps = {
  excludeProductId?: string;
  isUnitRole?: boolean;
  /**
   * Modo surtido: abre el alta rápida de un producto para añadirlo como
   * componente. Recibe el botón pulsado, para devolverle el foco al cerrar.
   */
  onCreateUnitProduct?: (trigger: HTMLButtonElement) => void;
  packConversion?: ProductPackConversionSummary;
  productName: string;
  /** Tras intentar enviar: muestra los avisos del empaque (unidades, producto unidad, surtido). */
  showErrors?: boolean;
  state: PackConversionFormState;
  /**
   * Al cambiar, el buscador de "Producto unidad" olvida las búsquedas ya
   * respondidas (p. ej. tras un guardado rechazado porque la unidad dejó de
   * estar libre). La unidad elegida se conserva.
   */
  unitSearchResetKey?: number | string;
  onChange: (patch: Partial<PackConversionFormState>) => void;
};

/** `name` del campo en el formulario, para poder llevarle el foco. */
export const UNITS_PER_PACK_FIELD_NAME = "unitsPerPack";

/**
 * Aviso de "Producto unidad", o `undefined` si vale: con el empaque activo en
 * modo "vincular producto existente" hay que elegir uno. El servidor responde
 * 400 si esto se envía.
 */
export function getUnitProductError(state: PackConversionFormState) {
  return state.enabled && state.mode === "link_existing" && !state.unitProductId
    ? "Elige el producto unidad."
    : undefined;
}

/** El buscador de "Producto unidad" dentro de `container`, para llevarle el foco. */
export function findUnitProductField(container: ParentNode) {
  return container.querySelector<HTMLInputElement>(
    '[data-pack-unit-product-field] input[role="combobox"]',
  );
}

/**
 * Aviso de "Unidades por empaque", o `undefined` si vale. Mismo límite que
 * `packConversionInputSchema` (entero, mínimo 2), que es quien responde
 * 400 si esto se envía.
 */
export function getUnitsPerPackError(text: string) {
  return (
    getNumberInputError(text, { decimals: 0 }) ??
    (Number(text) >= 2 ? undefined : "Indica unidades por empaque (mínimo 2).")
  );
}

const ALWAYS_DISASSEMBLE_HELP_ID = "pack-always-disassemble-help";
const UNIT_SALE_PRICE_REQUIRED_MESSAGE = "Escribe el precio de venta de la unidad.";

const PACK_LINKED_REASON = "Ya tiene un vínculo de empaque.";
const UNKNOWN_UNIT_LABEL = "Producto seleccionado";

// Vínculo 1 a 1: solo productos sin ningún vínculo de empaque.
const fetchUnitCandidates = createUnitCandidatesFetcher("none");

const MODE_OPTIONS: { label: string; value: PackConversionMode }[] = [
  { label: "Crear producto unidad", value: "create_unit" },
  { label: "Vincular producto existente", value: "link_existing" },
  { label: "Surtido (varios productos)", value: "assorted" },
];

function isPackConversionMode(value: string): value is PackConversionMode {
  return MODE_OPTIONS.some((option) => option.value === value);
}

/** Filas con las que abre el modo surtido al editar un empaque. */
function createComponentRows(packConversion: ProductPackConversionSummary) {
  const recipeRows = (packConversion.components ?? []).map((component) =>
    createPackComponentRow({
      costWeight: String(component.costWeight),
      isInactive: !component.isActive,
      unitName: component.name,
      unitProductId: component.unitProductId,
      unitsPerPack: String(component.unitsPerPack),
    }),
  );

  if (packConversion.kind === "assorted") {
    return recipeRows;
  }

  // Vínculo 1 a 1: al pasar a surtido, su unidad ya es el primer componente.
  return [
    recipeRows[0] ??
      createPackComponentRow({
        unitName: packConversion.linkedProduct.name,
        unitProductId: packConversion.linkedProduct.id,
        unitsPerPack: String(packConversion.unitsPerPack),
      }),
    createPackComponentRow(),
  ];
}

export function createDefaultPackConversionFormState(
  packConversion?: ProductPackConversionSummary,
): PackConversionFormState {
  if (packConversion?.role === "pack" && packConversion.kind === "assorted") {
    return {
      assortedLabel: packConversion.label ?? "",
      components: createComponentRows(packConversion),
      enabled: true,
      mode: "assorted",
      unitBarcode: "",
      unitName: "",
      unitProductId: "",
      unitSalePriceRef: "",
      unitSku: "",
      unitsPerPack: String(packConversion.totalUnits ?? packConversion.unitsPerPack),
    };
  }

  if (packConversion?.role === "pack") {
    return {
      assortedLabel: "",
      components: createComponentRows(packConversion),
      enabled: true,
      mode: "link_existing",
      unitBarcode: "",
      unitName: packConversion.linkedProduct.name,
      unitProductId: packConversion.linkedProduct.id,
      unitSalePriceRef: String(packConversion.linkedProduct.salePriceRef),
      unitSku: packConversion.linkedProduct.sku,
      unitsPerPack: String(packConversion.unitsPerPack),
    };
  }

  return {
    assortedLabel: "",
    components: [createPackComponentRow(), createPackComponentRow()],
    enabled: false,
    mode: "create_unit",
    unitBarcode: "",
    unitName: "",
    unitProductId: "",
    unitSalePriceRef: "",
    unitSku: "",
    unitsPerPack: "10",
  };
}

export function ProductPackConversionFields({
  excludeProductId,
  isUnitRole = false,
  onCreateUnitProduct,
  packConversion,
  productName,
  showErrors = false,
  state,
  unitSearchResetKey,
  onChange,
}: ProductPackConversionFieldsProps) {
  const [pickedUnit, setPickedUnit] = useState<EntityAutocompleteValue | null>(null);
  const [showRequired, setShowRequired] = useState(false);

  // Validación nativa (`required`) con aviso propio en vez del globo del navegador:
  // el foco va al campo solo si es el primero del formulario que falla.
  function handleRequiredInvalid(event: FormEvent<HTMLInputElement>) {
    const field = event.currentTarget;
    const firstInvalid = Array.from(field.form?.elements ?? []).find(
      (element) =>
        (element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement) &&
        element.willValidate &&
        !element.validity.valid,
    );

    event.preventDefault();
    setShowRequired(true);

    if (!firstInvalid || firstInvalid === field) {
      field.focus();
    }
  }
  // La unidad ya vinculada 1 a 1 a este empaque sigue siendo elegible para él.
  const linkedUnit =
    packConversion?.role === "pack" && packConversion.kind !== "assorted"
      ? packConversion.linkedProduct
      : undefined;
  const isAssorted = state.mode === "assorted";

  function getUnitValue(): EntityAutocompleteValue | null {
    if (!state.unitProductId) {
      return null;
    }

    if (pickedUnit?.id === state.unitProductId) {
      return pickedUnit;
    }

    return {
      id: state.unitProductId,
      label: linkedUnit?.id === state.unitProductId ? linkedUnit.name : UNKNOWN_UNIT_LABEL,
    };
  }

  if (isUnitRole && packConversion) {
    const sources = packConversion.sources ?? [];

    if (sources.length > 1) {
      return (
        <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-4 text-sm text-on-surface-variant">
          <p>
            Este producto es <span className="font-medium text-on-surface">unidad suelta</span> de{" "}
            {sources.length} empaques:
          </p>
          <ul className="mt-2 grid gap-1">
            {sources.map((source) => (
              <li className="[overflow-wrap:anywhere]" key={source.conversionId}>
                <span className="font-medium text-on-surface">{source.packName}</span> (
                {source.unitsPerPack} und/caja)
              </li>
            ))}
          </ul>
          <p className="mt-2">Edita cada empaque para cambiar su vínculo.</p>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-4 text-sm text-on-surface-variant">
        Este producto es la <span className="font-medium text-on-surface">unidad suelta</span> del
        empaque{" "}
        <span className="font-medium text-on-surface">{packConversion.linkedProduct.name}</span> (
        {packConversion.unitsPerPack} und/caja). Edita el empaque para cambiar el vínculo.
      </div>
    );
  }

  const unitsPerPackError = showErrors
    ? (getUnitsPerPackError(state.unitsPerPack) ??
      (isAssorted ? getAssortedPackErrors(state)?.total : undefined))
    : showRequired && !state.unitsPerPack.trim()
      ? getUnitsPerPackError(state.unitsPerPack)
      : undefined;

  return (
    <div className="grid min-w-0 gap-3 rounded-lg border border-outline-variant/40 p-4">
      <label className="flex items-center gap-2 text-sm text-on-surface">
        <input
          checked={state.enabled}
          className="size-4 accent-primary"
          onChange={(event) => onChange({ enabled: event.target.checked })}
          type="checkbox"
        />
        Se puede vender por unidad
      </label>

      {state.enabled ? (
        <>
          <NumberInput
            decimals={0}
            error={unitsPerPackError}
            helperText={
              isAssorted
                ? "Total de unidades que salen del empaque, entre todos sus productos."
                : undefined
            }
            label="Unidades por empaque"
            name={UNITS_PER_PACK_FIELD_NAME}
            onChange={(event) => onChange({ unitsPerPack: event.target.value })}
            onInvalid={handleRequiredInvalid}
            required
            value={state.unitsPerPack}
          />
          <SelectField
            label="Modo de vínculo"
            onChange={(event) => {
              if (isPackConversionMode(event.target.value)) {
                onChange({ mode: event.target.value });
              }
            }}
            options={MODE_OPTIONS}
            value={state.mode}
          />
          {isAssorted ? (
            <PackAssortedComponentsFields
              components={state.components}
              excludeProductId={excludeProductId}
              label={state.assortedLabel}
              onChange={onChange}
              onCreateUnitProduct={onCreateUnitProduct}
              searchResetKey={unitSearchResetKey}
              showErrors={showErrors}
              unitsPerPack={state.unitsPerPack}
            />
          ) : state.mode === "link_existing" ? (
            <div className="min-w-0" data-pack-unit-product-field="">
              <EntityAutocomplete
                entity="product"
                error={showErrors ? getUnitProductError(state) : undefined}
                fetcher={fetchUnitCandidates}
                filters={{ active: true, excludeIds: excludeProductId ? [excludeProductId] : [] }}
                getOptionDisabled={(option) =>
                  option.id !== linkedUnit?.id && isBlockedByPackLink(option) && PACK_LINKED_REASON
                }
                helperText="Solo productos activos sin vínculo de empaque."
                key={unitSearchResetKey}
                label="Producto unidad"
                onChange={(option) => {
                  setPickedUnit(option ? { id: option.id, label: option.label } : null);
                  onChange({ unitProductId: option?.id ?? "" });
                }}
                // Sin recientes: son una copia del navegador y la unidad guardada
                // puede tener ya un vínculo; se ofrecería habilitada y sin motivo.
                recentsKey={null}
                value={getUnitValue()}
              />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Nombre unidad"
                onChange={(event) => onChange({ unitName: event.target.value })}
                placeholder={`${productName.trim() || "Producto"} (unidad)`}
                value={state.unitName}
              />
              <Input
                label="SKU unidad"
                onChange={(event) => onChange({ unitSku: event.target.value.toLowerCase() })}
                placeholder="Opcional (auto)"
                value={state.unitSku}
              />
              <Input
                label="Código de barras unidad"
                onChange={(event) => onChange({ unitBarcode: event.target.value })}
                placeholder="Opcional"
                value={state.unitBarcode}
              />
              <NumberInput
                decimals={2}
                error={
                  showRequired && !state.unitSalePriceRef.trim()
                    ? UNIT_SALE_PRICE_REQUIRED_MESSAGE
                    : undefined
                }
                label="Precio venta unidad (ref)"
                onChange={(event) => onChange({ unitSalePriceRef: event.target.value })}
                onInvalid={handleRequiredInvalid}
                required
                value={state.unitSalePriceRef}
              />
            </div>
          )}
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm text-on-surface">
              <input
                aria-describedby={ALWAYS_DISASSEMBLE_HELP_ID}
                checked={
                  state.alwaysDisassembleOnReceive ??
                  (packConversion?.role === "pack" &&
                    packConversion.alwaysDisassembleOnReceive === true)
                }
                className="size-4 accent-primary"
                onChange={(event) => onChange({ alwaysDisassembleOnReceive: event.target.checked })}
                type="checkbox"
              />
              Desarmar siempre al recibir compras
            </label>
            <p className="text-xs text-on-surface-variant" id={ALWAYS_DISASSEMBLE_HELP_ID}>
              Al comprar este empaque, la línea nace marcada «Desarmar al recibir»; se puede
              desmarcar en cada compra.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** La preferencia solo viaja si el usuario tocó la casilla: ausente = no cambia. */
function alwaysDisassembleInput(state: PackConversionFormState) {
  return state.alwaysDisassembleOnReceive === undefined
    ? {}
    : { alwaysDisassembleOnReceive: state.alwaysDisassembleOnReceive };
}

export function packConversionStateToInput(state: PackConversionFormState) {
  if (!state.enabled) {
    return { enabled: false as const };
  }

  if (state.mode === "assorted") {
    return {
      ...alwaysDisassembleInput(state),
      // El peso por defecto (1) no viaja: lo pone el servidor.
      components: state.components.map((row) => {
        const costWeight = getPackComponentCostWeight(row.costWeight);

        return {
          ...(costWeight !== null && costWeight !== 1 ? { costWeight } : {}),
          unitProductId: row.unitProductId,
          unitsPerPack: Number(row.unitsPerPack),
        };
      }),
      enabled: true as const,
      label: state.assortedLabel.trim() || null,
      mode: "assorted" as const,
      totalUnits: Number(state.unitsPerPack),
    };
  }

  if (state.mode === "link_existing") {
    return {
      ...alwaysDisassembleInput(state),
      enabled: true as const,
      mode: "link_existing" as const,
      unitProductId: state.unitProductId || undefined,
      unitsPerPack: Number(state.unitsPerPack),
    };
  }

  return {
    ...alwaysDisassembleInput(state),
    enabled: true as const,
    mode: "create_unit" as const,
    unitsPerPack: Number(state.unitsPerPack),
    unitProduct: {
      barcode: state.unitBarcode || null,
      name: state.unitName.trim() || undefined,
      salePriceRef: Number(state.unitSalePriceRef || 0),
      sku: state.unitSku.trim() || undefined,
    },
  };
}
