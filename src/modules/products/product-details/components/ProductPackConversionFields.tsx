"use client";

import { useMemo } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import { useProducts } from "../../hooks/useProducts";

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
  state: PackConversionFormState;
  onChange: (patch: Partial<PackConversionFormState>) => void;
};

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
  state,
  onChange,
}: ProductPackConversionFieldsProps) {
  const productsQuery = useProducts({ isActive: true, limit: 100 });
  const productOptions = useMemo(
    () =>
      getPaginatedItems(productsQuery.data)
        .filter((product) => product.id !== excludeProductId)
        .map((product) => ({
          label: `${product.name} (${product.sku})`,
          value: product.id,
        })),
    [excludeProductId, productsQuery.data],
  );

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
          <Input
            label="Unidades por empaque"
            min={2}
            onChange={(event) => onChange({ unitsPerPack: event.target.value })}
            required
            type="number"
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
            <SelectField
              label="Producto unidad"
              onChange={(event) => onChange({ unitProductId: event.target.value })}
              options={productOptions}
              placeholder="Selecciona"
              value={state.unitProductId}
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
              <Input
                label="Precio venta unidad (ref)"
                min={0}
                onChange={(event) => onChange({ unitSalePriceRef: event.target.value })}
                required
                step="0.01"
                type="number"
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
