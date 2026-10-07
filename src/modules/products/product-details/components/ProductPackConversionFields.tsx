"use client";

import { useState } from "react";

import { MAX_PAGE_LIMIT, type PaginatedList } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import {
  EntityAutocomplete,
  type EntityAutocompleteValue,
  type EntityFetcher,
  type ProductEntityOption,
  toProductEntityOption,
} from "@/shared/components/EntityAutocomplete";
import { Input } from "@/shared/components/Input";
import { getNumberInputError, NumberInput } from "@/shared/components/NumberInput";
import { SelectField } from "@/shared/components/SelectField";
import type { ProductMock, ProductPackConversionSummary } from "@/shared/mocks/erp-data";

export type PackConversionFormState = {
  enabled: boolean;
  mode: "create_unit" | "link_existing";
  unitBarcode: string;
  unitName: string;
  unitProductId: string;
  unitSalePriceRef: string;
  unitSku: string;
  unitsPerPack: string;
};

type ProductPackConversionFieldsProps = {
  excludeProductId?: string;
  isUnitRole?: boolean;
  packConversion?: ProductPackConversionSummary;
  productName: string;
  /** Tras intentar enviar: muestra el aviso del minimo de unidades por empaque. */
  showErrors?: boolean;
  state: PackConversionFormState;
  onChange: (patch: Partial<PackConversionFormState>) => void;
};

/** `name` del campo en el formulario, para poder llevarle el foco. */
export const UNITS_PER_PACK_FIELD_NAME = "unitsPerPack";

/**
 * Aviso de "Unidades por empaque", o `undefined` si vale. Mismo limite y mismo
 * texto que `packConversionInputSchema` (entero, minimo 2), que es quien responde
 * 400 si esto se envia.
 */
export function getUnitsPerPackError(text: string) {
  return (
    getNumberInputError(text, { decimals: 0 }) ??
    (Number(text) >= 2 ? undefined : "Indica unidades por empaque (minimo 2).")
  );
}

const PACK_LINKED_REASON = "Ya tiene un vínculo de empaque.";
const UNIT_RECENTS_KEY = "pack-unit";
const UNKNOWN_UNIT_LABEL = "Producto seleccionado";

type UnitCandidateOption = ProductEntityOption & { hasPackLink: boolean };

type ProductSearchCriteria = { barcode: string } | { search: string } | { sku: string };

/**
 * Candidatos a producto unidad desde `GET /api/products`. Cada búsqueda se pide
 * dos veces, con y sin `packLink=none`: los que solo vienen sin el filtro ya
 * tienen un vínculo de empaque (como empaque o como unidad) y van al final,
 * marcados para mostrarse deshabilitados con su motivo.
 */
const fetchUnitCandidates: EntityFetcher<"product"> = async ({
  exact,
  filters,
  limit,
  query,
  signal,
}): Promise<UnitCandidateOption[]> => {
  // Lector de barras: `barcode` y `sku` son igualdad exacta en servidor.
  const criteria: ProductSearchCriteria[] = exact
    ? [{ barcode: query }, { sku: query }, { search: query }]
    : [{ search: query }];

  async function requestProducts(packLink?: "none") {
    const pages = await Promise.all(
      criteria.map((criterion) =>
        apiFetch<PaginatedList<ProductMock>>("/api/products", {
          query: {
            ...criterion,
            isActive: filters.active,
            limit: Math.min(MAX_PAGE_LIMIT, limit + (filters.excludeIds?.length ?? 0)),
            packLink,
            skip: 0,
          },
          signal,
        }),
      ),
    );

    return pages.flatMap((page) => page.items);
  }

  const [withoutLink, all] = await Promise.all([requestProducts("none"), requestProducts()]);
  const freeIds = new Set(withoutLink.map((product) => product.id));
  const seen = new Set<string>();

  return [...withoutLink, ...all]
    .filter((product) => {
      if (seen.has(product.id)) {
        return false;
      }

      seen.add(product.id);
      return true;
    })
    .map((product) => ({
      ...toProductEntityOption(product),
      hasPackLink: !freeIds.has(product.id),
    }));
};

function hasPackLink(option: ProductEntityOption) {
  return "hasPackLink" in option && option.hasPackLink === true;
}

export function createDefaultPackConversionFormState(
  packConversion?: ProductPackConversionSummary,
): PackConversionFormState {
  if (packConversion?.role === "pack") {
    return {
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
  packConversion,
  productName,
  showErrors = false,
  state,
  onChange,
}: ProductPackConversionFieldsProps) {
  const [pickedUnit, setPickedUnit] = useState<EntityAutocompleteValue | null>(null);
  // La unidad ya vinculada a este empaque sigue siendo elegible para él.
  const linkedUnit = packConversion?.role === "pack" ? packConversion.linkedProduct : undefined;

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
    return (
      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-4 text-sm text-on-surface-variant">
        Este producto es la <span className="font-medium text-on-surface">unidad suelta</span> del
        empaque{" "}
        <span className="font-medium text-on-surface">{packConversion.linkedProduct.name}</span> (
        {packConversion.unitsPerPack} und/caja). Edita el empaque para cambiar el vinculo.
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border border-outline-variant/40 p-4">
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
            error={showErrors ? getUnitsPerPackError(state.unitsPerPack) : undefined}
            label="Unidades por empaque"
            name={UNITS_PER_PACK_FIELD_NAME}
            onChange={(event) => onChange({ unitsPerPack: event.target.value })}
            required
            value={state.unitsPerPack}
          />
          <SelectField
            label="Modo de vinculo"
            onChange={(event) =>
              onChange({
                mode: event.target.value as "create_unit" | "link_existing",
              })
            }
            options={[
              { label: "Crear producto unidad", value: "create_unit" },
              { label: "Vincular producto existente", value: "link_existing" },
            ]}
            value={state.mode}
          />
          {state.mode === "link_existing" ? (
            <EntityAutocomplete
              entity="product"
              fetcher={fetchUnitCandidates}
              filters={{ active: true, excludeIds: excludeProductId ? [excludeProductId] : [] }}
              getOptionDisabled={(option) =>
                option.id !== linkedUnit?.id && hasPackLink(option) && PACK_LINKED_REASON
              }
              helperText="Solo productos activos sin vínculo de empaque."
              label="Producto unidad"
              onChange={(option) => {
                setPickedUnit(option ? { id: option.id, label: option.label } : null);
                onChange({ unitProductId: option?.id ?? "" });
              }}
              recentsKey={UNIT_RECENTS_KEY}
              value={getUnitValue()}
            />
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
                label="Barcode unidad"
                onChange={(event) => onChange({ unitBarcode: event.target.value })}
                placeholder="Opcional"
                value={state.unitBarcode}
              />
              <NumberInput
                decimals={2}
                label="Precio venta unidad (ref)"
                onChange={(event) => onChange({ unitSalePriceRef: event.target.value })}
                required
                value={state.unitSalePriceRef}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export function packConversionStateToInput(state: PackConversionFormState) {
  if (!state.enabled) {
    return { enabled: false as const };
  }

  if (state.mode === "link_existing") {
    return {
      enabled: true as const,
      mode: "link_existing" as const,
      unitProductId: state.unitProductId || undefined,
      unitsPerPack: Number(state.unitsPerPack),
    };
  }

  return {
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
