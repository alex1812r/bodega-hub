"use client";

import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { GenerateSkuIconButton } from "@/shared/components/GenerateSkuIconButton";
import { Input } from "@/shared/components/Input";
import { NumberInput } from "@/shared/components/NumberInput";
import { Textarea } from "@/shared/components/Textarea";
import { generateProductSkuFromName } from "@/shared/utils/skuGeneration";

import type { ProductWithCategory } from "../../hooks/useProducts";
import {
  ProductPackConversionFields,
  type PackConversionFormState,
} from "./ProductPackConversionFields";

/** `name` del campo SKU en el formulario, para poder llevarle el foco. */
export const SKU_FIELD_NAME = "sku";

export const SKU_REQUIRED_MESSAGE = "Indica el SKU o genéralo desde el nombre con el botón.";

type ProductFormMoreOptionsProps = {
  isEdit: boolean;
  isUnitRole: boolean;
  onOpenChange: (open: boolean) => void;
  onPackConversionChange: (patch: Partial<PackConversionFormState>) => void;
  onSkuChange: (sku: string) => void;
  open: boolean;
  packConversionState: PackConversionFormState;
  product?: ProductWithCategory;
  productName: string;
  /** Tras intentar enviar: muestra los avisos de SKU y de unidades por empaque. */
  showErrors: boolean;
  sku: string;
};

/**
 * Segundo nivel del formulario de producto: SKU, Descripción, stock y empaque.
 * Cerrada, la sección solo se oculta (`hidden`): sus campos siguen montados y
 * viajan en el envío igual que si estuviera abierta.
 */
export function ProductFormMoreOptions({
  isEdit,
  isUnitRole,
  onOpenChange,
  onPackConversionChange,
  onSkuChange,
  open,
  packConversionState,
  product,
  productName,
  showErrors,
  sku,
}: ProductFormMoreOptionsProps) {
  return (
    <CollapsibleSection
      onOpenChange={onOpenChange}
      open={open}
      summary={
        isEdit && product
          ? `SKU ${sku || "sin definir"} · Stock actual ${product.currentStock}`
          : "SKU, descripción, stock y empaque"
      }
      title="Más opciones"
    >
      <div className="grid gap-4">
        <Input
          aria-required
          error={showErrors && !sku.trim() ? SKU_REQUIRED_MESSAGE : undefined}
          label="SKU"
          name={SKU_FIELD_NAME}
          onChange={(event) => onSkuChange(event.target.value.toLowerCase())}
          trailing={
            <GenerateSkuIconButton
              disabled={!productName.trim()}
              onGenerate={() => onSkuChange(generateProductSkuFromName(productName))}
            />
          }
          value={sku}
        />
        <Textarea label="Descripción" placeholder="Detalles del producto" />
        <div className="grid gap-4 md:grid-cols-2">
          {isEdit ? (
            <NumberInput
              decimals={0}
              defaultValue={product?.currentStock}
              disabled
              helperText="Se corrige desde Inventario con un ajuste, para que quede registrado el movimiento."
              label="Stock actual"
              readOnly
            />
          ) : (
            <NumberInput
              decimals={0}
              defaultValue={product?.currentStock}
              label="Stock inicial"
              name="currentStock"
            />
          )}
          <NumberInput
            decimals={0}
            defaultValue={product?.minStock}
            label="Stock mínimo"
            name="minStock"
          />
        </div>
        <ProductPackConversionFields
          excludeProductId={product?.id}
          isUnitRole={isUnitRole}
          packConversion={product?.packConversion}
          productName={productName}
          showErrors={showErrors}
          state={packConversionState}
          onChange={onPackConversionChange}
        />
      </div>
    </CollapsibleSection>
  );
}
