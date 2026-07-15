"use client";

import { type FormEvent, useEffect, useId, useMemo, useState } from "react";

import { useRegisterSupplierPrice } from "@/modules/contacts/hooks/useSupplierProductMutations";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { Textarea } from "@/shared/components/Textarea";
import { formatRefUsd } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import {
  getSupplierProductDefaultPackUnit,
  getSupplierProductPackCostRef,
  resolveSupplierProductRegisterCostRef,
  type SupplierProductPriceInputMode,
} from "./ManageSupplierProductPackUnitsModal";
import { SupplierProductVariationBadge } from "./SupplierProductVariationBadge";

import type { SupplierProduct } from "../../types/supplierProducts";

type RegisterSupplierPriceModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  supplierProduct: SupplierProduct | null;
};

export function RegisterSupplierPriceModal({
  onOpenChange,
  onSuccess,
  open,
  supplierProduct,
}: RegisterSupplierPriceModalProps) {
  const formId = useId();
  const [inputMode, setInputMode] = useState<SupplierProductPriceInputMode>("unit");
  const [inputValue, setInputValue] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const registerPrice = useRegisterSupplierPrice(supplierProduct?.id ?? "");

  const defaultPackUnit = supplierProduct
    ? getSupplierProductDefaultPackUnit(supplierProduct.packUnits, supplierProduct.defaultPackUnit)
    : undefined;
  const canRegisterByPack = Boolean(defaultPackUnit && defaultPackUnit.unitsPerPack > 1);

  useEffect(() => {
    if (!open) {
      return;
    }

    setInputMode("unit");
    setInputValue("");
    setNotes("");
    setErrorMessage(null);
  }, [open, supplierProduct?.id]);

  const resolvedUnitCostRef = useMemo(() => {
    if (!supplierProduct || !inputValue.trim()) {
      return null;
    }

    const parsed = Number(inputValue);
    const resolved = resolveSupplierProductRegisterCostRef(
      parsed,
      inputMode,
      supplierProduct.packUnits,
      supplierProduct.defaultPackUnit,
    );

    return "unitCostRef" in resolved ? resolved.unitCostRef : null;
  }, [inputMode, inputValue, supplierProduct]);

  const previewVariation = useMemo(() => {
    if (!supplierProduct || resolvedUnitCostRef == null) {
      return null;
    }

    const previousCost = supplierProduct.lastCostRef ?? 0;

    if (previousCost <= 0) {
      return null;
    }

    return Number((((resolvedUnitCostRef - previousCost) / previousCost) * 100).toFixed(2));
  }, [resolvedUnitCostRef, supplierProduct]);

  const currentPackCostRef = supplierProduct
    ? getSupplierProductPackCostRef(
        supplierProduct.lastCostRef,
        supplierProduct.packUnits,
        supplierProduct.defaultPackUnit,
        supplierProduct.lastPackCostRef,
      )
    : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierProduct) return;

    setErrorMessage(null);
    const parsed = Number(inputValue);
    const resolved = resolveSupplierProductRegisterCostRef(
      parsed,
      inputMode,
      supplierProduct.packUnits,
      supplierProduct.defaultPackUnit,
    );

    if ("error" in resolved) {
      setErrorMessage(resolved.error);
      return;
    }

    const noteParts = [notes.trim()].filter(Boolean);
    if (inputMode === "pack" && defaultPackUnit) {
      noteParts.unshift(
        `${formatRefUsd(parsed)} ref / ${defaultPackUnit.label} ${defaultPackUnit.unitsPerPack} und`,
      );
    }

    try {
      await registerPrice.mutateAsync({
        newCostRef: resolved.unitCostRef,
        newPackCostRef: resolved.priceInputMode === "pack" ? resolved.packCostRef : undefined,
        notes: noteParts.length > 0 ? noteParts.join(" — ") : undefined,
        origin: "cotizacion",
        priceInputMode: resolved.priceInputMode,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo registrar el precio.");
    }
  }

  function handleInputModeChange(mode: SupplierProductPriceInputMode) {
    setInputMode(mode);
    setInputValue("");
    setErrorMessage(null);
  }

  return (
    <Modal
      description="Registra una cotización o relevamiento de precio. Se guardará en el historial."
      footer={({ close }) => (
        <FormActions
          isSubmitting={registerPrice.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel="Registrar precio"
          submittingLabel="Guardando..."
        />
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Registrar precio"
    >
      {supplierProduct ? (
        <form className="space-y-4" id={formId} onSubmit={(event) => void handleSubmit(event)}>
          <div className="rounded-lg border border-outline-variant/60 bg-surface-container-low px-4 py-3 text-sm">
            <p>
              <span className="text-on-surface-variant">Proveedor:</span>{" "}
              {supplierProduct.supplier?.name ?? supplierProduct.supplierId}
            </p>
            <p>
              <span className="text-on-surface-variant">Producto:</span>{" "}
              {supplierProduct.product?.name ?? supplierProduct.productId}
              {supplierProduct.product?.sku ? ` (${supplierProduct.product.sku})` : ""}
            </p>
            <p>
              <span className="text-on-surface-variant">Costo unitario actual:</span>{" "}
              {formatRefUsd(supplierProduct.lastCostRef ?? 0)}
            </p>
            {currentPackCostRef != null && defaultPackUnit ? (
              <p>
                <span className="text-on-surface-variant">Precio empaque actual:</span>{" "}
                {formatRefUsd(currentPackCostRef)}{" "}
                <span className="text-on-surface-variant">
                  ({defaultPackUnit.label} {defaultPackUnit.unitsPerPack} und)
                </span>
              </p>
            ) : null}
          </div>

          {canRegisterByPack ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Registrar por</p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    inputMode === "unit"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-outline-variant text-on-surface-variant",
                  )}
                  onClick={() => handleInputModeChange("unit")}
                  type="button"
                >
                  Unidad
                </button>
                <button
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    inputMode === "pack"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-outline-variant text-on-surface-variant",
                  )}
                  onClick={() => handleInputModeChange("pack")}
                  type="button"
                >
                  Empaque ({defaultPackUnit?.label} {defaultPackUnit?.unitsPerPack} und)
                </button>
              </div>
            </div>
          ) : null}

          <Input
            inputMode="decimal"
            label={
              inputMode === "pack"
                ? `Precio del empaque (REF)`
                : "Nuevo costo unitario (REF)"
            }
            onChange={(event) => setInputValue(event.target.value)}
            required
            value={inputValue}
          />

          {inputMode === "pack" && resolvedUnitCostRef != null ? (
            <p className="text-sm text-on-surface-variant">
              Costo unitario calculado:{" "}
              <span className="font-mono font-medium text-foreground">
                {formatRefUsd(resolvedUnitCostRef)}
              </span>
            </p>
          ) : null}

          {previewVariation != null ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-on-surface-variant">Variación estimada (unit.):</span>
              <SupplierProductVariationBadge variationPercent={previewVariation} />
            </div>
          ) : null}

          <Textarea
            label="Notas"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ej. relevamiento telefónico"
            rows={2}
            value={notes}
          />
          {errorMessage ? <p className="text-sm text-error">{errorMessage}</p> : null}
        </form>
      ) : null}
    </Modal>
  );
}
