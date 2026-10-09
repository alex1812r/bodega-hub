"use client";

import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";
import { fromCents, toCents } from "@/shared/impact/impactVerdict";
import { formatRefUsd } from "@/shared/utils/currency";

import { useUpdateProduct } from "../../hooks/useProducts";

import type { ProductWithCategory } from "../../hooks/useProducts";

type DeactivateProductConfirmModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  product: ProductWithCategory | null;
};

const quantityFormatter = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 3 });

/**
 * Lo que pasa de verdad al desactivar: solo cambia `is_active`. El stock no se
 * toca, así que las unidades que haya se quedan en inventario sin poder venderse.
 */
export function buildDeactivateProductEffects(
  product: Pick<ProductWithCategory, "currentCostRef" | "currentStock"> | null,
): ConfirmActionEffect[] {
  const stock = product?.currentStock ?? 0;
  const effects: ConfirmActionEffect[] = [
    { after: "Inactivo", before: "Activo", label: "Estado en el catálogo", tone: "warning" },
    { label: "No podrá venderse", tone: "warning" },
  ];

  if (product && stock > 0) {
    const units = `${quantityFormatter.format(stock)} ${stock === 1 ? "unidad" : "unidades"}`;
    const costRef = fromCents(Math.round(stock * toCents(product.currentCostRef)));

    effects.push({
      after: `${units} · ${formatRefUsd(costRef)} al costo`,
      label: "Stock que queda inmovilizado (sigue en inventario, sin poder venderse)",
      tone: "warning",
    });
  } else if (product) {
    effects.push({ label: "No tiene stock que quede inmovilizado" });
  }

  effects.push({ label: "El historial de ventas, compras y precios se conserva" });

  return effects;
}

export function DeactivateProductConfirmModal({
  onOpenChange,
  onSuccess,
  open,
  product,
}: DeactivateProductConfirmModalProps) {
  const updateProduct = useUpdateProduct(product?.id ?? "");

  async function handleConfirm() {
    if (!product) return;

    await updateProduct.mutateAsync({ isActive: false });
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <ConfirmActionModal
      confirmLabel="Desactivar producto"
      description="El producto dejará de aparecer en el catálogo activo y no podrá venderse. El historial de ventas, compras y precios se conservará."
      effects={buildDeactivateProductEffects(product)}
      error={updateProduct.error instanceof Error ? updateProduct.error.message : null}
      isPending={updateProduct.isPending}
      onConfirm={handleConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title="Confirmar desactivación"
      variant="danger"
    >
      <p>
        <span className="font-medium text-foreground">{product?.name ?? "Producto"}</span>
        {product?.sku ? (
          <>
            {" "}
            (<span className="font-mono">{product.sku}</span>)
          </>
        ) : null}{" "}
        quedará inactivo.
      </p>
    </ConfirmActionModal>
  );
}
