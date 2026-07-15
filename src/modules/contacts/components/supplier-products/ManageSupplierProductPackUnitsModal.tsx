"use client";

import { type FormEvent, useId, useState } from "react";

import {
  useCreateSupplierProductPackUnit,
  useDeactivateSupplierProductPackUnit,
  useSupplierProductPackUnits,
  useUpdateSupplierProductPackUnit,
} from "@/modules/contacts/hooks/useSupplierProductPackUnits";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";

import type { SupplierProduct } from "../../types/supplierProducts";

type ManageSupplierProductPackUnitsModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  supplierProduct: SupplierProduct | null;
};

type DraftPackUnit = {
  isDefault: boolean;
  label: string;
  unitsPerPack: string;
};

export function formatSupplierProductPackUnitsSummary(
  packUnits: SupplierProduct["packUnits"],
) {
  if (!packUnits?.length) {
    return "—";
  }

  return packUnits
    .filter((packUnit) => packUnit.isActive)
    .map((packUnit) => `${packUnit.label} ${packUnit.unitsPerPack}u`)
    .join(", ");
}

export function getSupplierProductDefaultPackUnit(
  packUnits: SupplierProduct["packUnits"],
  defaultPackUnit?: SupplierProduct["defaultPackUnit"],
) {
  if (defaultPackUnit != null && defaultPackUnit.isActive !== false) {
    return defaultPackUnit;
  }

  const activePackUnits = packUnits?.filter((packUnit) => packUnit.isActive) ?? [];

  return activePackUnits.find((packUnit) => packUnit.isDefault) ?? activePackUnits[0];
}

export function getSupplierProductPackCostRef(
  lastCostRef: number | undefined,
  packUnits: SupplierProduct["packUnits"],
  defaultPackUnit?: SupplierProduct["defaultPackUnit"],
  lastPackCostRef?: number | null,
) {
  const packUnit = getSupplierProductDefaultPackUnit(packUnits, defaultPackUnit);

  if (!packUnit || packUnit.unitsPerPack <= 1) {
    return null;
  }

  if (lastPackCostRef != null) {
    return lastPackCostRef;
  }

  return Number(((lastCostRef ?? 0) * packUnit.unitsPerPack).toFixed(2));
}

export function getSupplierProductUnitCostFromPackRef(
  packCostRef: number,
  packUnits: SupplierProduct["packUnits"],
  defaultPackUnit?: SupplierProduct["defaultPackUnit"],
) {
  const packUnit = getSupplierProductDefaultPackUnit(packUnits, defaultPackUnit);

  if (!packUnit || packUnit.unitsPerPack <= 1) {
    return null;
  }

  return Number((packCostRef / packUnit.unitsPerPack).toFixed(2));
}

export type SupplierProductPriceInputMode = "pack" | "unit";

export function resolveSupplierProductRegisterCostRef(
  inputValue: number,
  inputMode: SupplierProductPriceInputMode,
  packUnits: SupplierProduct["packUnits"],
  defaultPackUnit?: SupplierProduct["defaultPackUnit"],
):
  | { packCostRef: number; priceInputMode: "pack"; unitCostRef: number }
  | { priceInputMode: "unit"; unitCostRef: number }
  | { error: string } {
  if (Number.isNaN(inputValue) || inputValue < 0) {
    return { error: "Indica un costo válido mayor o igual a 0." };
  }

  if (inputMode === "unit") {
    return { priceInputMode: "unit", unitCostRef: inputValue };
  }

  const unitCostRef = getSupplierProductUnitCostFromPackRef(
    inputValue,
    packUnits,
    defaultPackUnit,
  );

  if (unitCostRef == null) {
    return { error: "Configura un empaque con más de 1 unidad para registrar por empaque." };
  }

  return {
    packCostRef: inputValue,
    priceInputMode: "pack",
    unitCostRef,
  };
}

export function ManageSupplierProductPackUnitsModal({
  onOpenChange,
  open,
  supplierProduct,
}: ManageSupplierProductPackUnitsModalProps) {
  const formId = useId();
  const supplierProductId = supplierProduct?.id ?? "";
  const packUnitsQuery = useSupplierProductPackUnits(supplierProductId);
  const createPackUnit = useCreateSupplierProductPackUnit(supplierProductId);
  const deactivatePackUnit = useDeactivateSupplierProductPackUnit(supplierProductId);
  const [draft, setDraft] = useState<DraftPackUnit>({
    isDefault: false,
    label: "",
    unitsPerPack: "",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierProductId) return;

    const unitsPerPack = Number(draft.unitsPerPack);
    if (!draft.label.trim() || !Number.isFinite(unitsPerPack) || unitsPerPack <= 0) {
      setErrorMessage("Indica etiqueta y unidades por empaque validas.");
      return;
    }

    setErrorMessage(null);

    try {
      await createPackUnit.mutateAsync({
        isDefault: draft.isDefault,
        label: draft.label.trim(),
        unitsPerPack,
      });
      setDraft({ isDefault: false, label: "", unitsPerPack: "" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo crear el empaque.");
    }
  }

  return (
    <Modal
      description="Define bultos, cajas o paquetes para autocompletar en compras."
      onOpenChange={onOpenChange}
      open={open}
      title="Empaques del producto"
    >
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant">
          {supplierProduct?.product?.name ?? supplierProduct?.productId}
        </p>

        {packUnitsQuery.isLoading ? (
          <p className="text-sm text-on-surface-variant">Cargando empaques...</p>
        ) : null}

        {packUnitsQuery.data?.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {packUnitsQuery.data.map((packUnit) => (
              <PackUnitRow
                deactivatePackUnit={deactivatePackUnit}
                key={packUnit.id}
                packUnit={packUnit}
                supplierProductId={supplierProductId}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-on-surface-variant">Sin empaques configurados.</p>
        )}

        <form className="space-y-3 rounded-lg border border-border p-4" id={formId} onSubmit={handleCreate}>
          <p className="text-sm font-medium text-foreground">Agregar empaque</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Etiqueta"
              onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
              placeholder="Bulto, Caja, Paquete..."
              value={draft.label}
            />
            <Input
              label="Unidades por empaque"
              min="1"
              onChange={(event) =>
                setDraft((current) => ({ ...current, unitsPerPack: event.target.value }))
              }
              type="number"
              value={draft.unitsPerPack}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              checked={draft.isDefault}
              className="size-4 rounded border-border"
              onChange={(event) =>
                setDraft((current) => ({ ...current, isDefault: event.target.checked }))
              }
              type="checkbox"
            />
            Usar como empaque predeterminado
          </label>
          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
          <Button disabled={createPackUnit.isPending} size="sm" type="submit">
            {createPackUnit.isPending ? "Guardando..." : "Agregar empaque"}
          </Button>
        </form>
      </div>
    </Modal>
  );
}

function PackUnitRow({
  deactivatePackUnit,
  packUnit,
  supplierProductId,
}: {
  deactivatePackUnit: ReturnType<typeof useDeactivateSupplierProductPackUnit>;
  packUnit: {
    id: string;
    isActive: boolean;
    isDefault: boolean;
    label: string;
    unitsPerPack: number;
  };
  supplierProductId: string;
}) {
  const updatePackUnit = useUpdateSupplierProductPackUnit(supplierProductId, packUnit.id);

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3",
        !packUnit.isActive && "opacity-50",
      )}
    >
      <div>
        <p className="text-sm font-medium text-foreground">
          {packUnit.label}{" "}
          <span className="font-normal text-on-surface-variant">· {packUnit.unitsPerPack} u</span>
        </p>
        {packUnit.isDefault ? (
          <p className="text-xs text-primary">Predeterminado</p>
        ) : null}
      </div>
      {packUnit.isActive ? (
        <div className="flex items-center gap-2">
          {!packUnit.isDefault ? (
            <Button
              disabled={updatePackUnit.isPending}
              onClick={() => void updatePackUnit.mutateAsync({ isDefault: true })}
              size="sm"
              type="button"
              variant="ghost"
            >
              Predeterminado
            </Button>
          ) : null}
          <Button
            disabled={deactivatePackUnit.isPending}
            onClick={() => void deactivatePackUnit.mutateAsync(packUnit.id)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Quitar
          </Button>
        </div>
      ) : null}
    </li>
  );
}
