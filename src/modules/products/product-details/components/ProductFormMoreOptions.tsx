"use client";

import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
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

const SKU_HELPER_TEXT =
  "Código interno; si tienes código de barras, úsalo. Si lo dejas vacío se genera solo.";

type ProductFormMoreOptionsProps = {
  isEdit: boolean;
  isUnitRole: boolean;
  /**
   * Edición: abre el ajuste de inventario del producto. Recibe el botón pulsado,
   * para devolverle el foco al cerrar. El botón exige `inventory.manage`.
   */
  onAdjustStock?: (trigger: HTMLButtonElement) => void;
  /**
   * Empaque surtido: abre el alta rápida de un producto componente. Recibe el
   * botón pulsado, para devolverle el foco al cerrar.
   */
  onCreatePackUnitProduct?: (trigger: HTMLButtonElement) => void;
  onOpenChange: (open: boolean) => void;
  onPackConversionChange: (patch: Partial<PackConversionFormState>) => void;
  onSkuChange: (sku: string) => void;
  open: boolean;
  packConversionState: PackConversionFormState;
  product?: ProductWithCategory;
  productName: string;
  /** Tras intentar enviar: muestra los avisos del empaque. */
  showErrors: boolean;
  sku: string;
  /** Cambia tras un guardado rechazado: el buscador de unidad vuelve a preguntar al servidor. */
  unitSearchResetKey?: number;
};

/**
 * Segundo nivel del formulario de producto: SKU, Descripción, stock y empaque.
 * Cerrada, la sección solo se oculta (`hidden`): sus campos siguen montados y
 * viajan en el envío igual que si estuviera abierta.
 */
export function ProductFormMoreOptions({
  isEdit,
  isUnitRole,
  onAdjustStock,
  onCreatePackUnitProduct,
  onOpenChange,
  onPackConversionChange,
  onSkuChange,
  open,
  packConversionState,
  product,
  productName,
  showErrors,
  sku,
  unitSearchResetKey,
}: ProductFormMoreOptionsProps) {
  const summary =
    isEdit && product
      ? `SKU ${sku || product.sku} · Stock actual ${product.currentStock}`
      : "SKU, descripción, stock y empaque";

  return (
    <CollapsibleSection
      // Item del grid del formulario: sin `min-w-0` su ancho mínimo es el del
      // resumen en una sola línea y un SKU largo desborda el modal.
      className="min-w-0"
      onOpenChange={onOpenChange}
      open={open}
      summary={
        <span className="block truncate" title={summary}>
          {summary}
        </span>
      }
      title="Más opciones"
    >
      <div className="grid gap-4">
        <Input
          helperText={SKU_HELPER_TEXT}
          label="SKU"
          name="sku"
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
            <div className="space-y-2">
              {/* Controlado: tras un ajuste muestra el stock recién consultado. */}
              <NumberInput
                decimals={0}
                disabled
                helperText="Se corrige desde Inventario con un ajuste, para que quede registrado el movimiento."
                label="Stock actual"
                readOnly
                value={product?.currentStock}
              />
              {onAdjustStock ? (
                <Can permission="inventory.manage">
                  <Button
                    onClick={(event) => onAdjustStock(event.currentTarget)}
                    size="sm"
                    variant="outline"
                  >
                    Ajustar stock
                  </Button>
                </Can>
              ) : null}
            </div>
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
          onCreateUnitProduct={onCreatePackUnitProduct}
          packConversion={product?.packConversion}
          productName={productName}
          showErrors={showErrors}
          state={packConversionState}
          unitSearchResetKey={unitSearchResetKey}
          onChange={onPackConversionChange}
        />
      </div>
    </CollapsibleSection>
  );
}
