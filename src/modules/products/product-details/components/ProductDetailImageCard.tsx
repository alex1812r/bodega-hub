import { PosProductImage } from "@/modules/sales/sale-create/components/PosProductImage";

import { ProductDetailSectionCard } from "./ProductDetailSectionCard";

type ProductDetailImageCardProps = {
  /** Quien puede editar el producto ve dónde se cambia la imagen. */
  canManage?: boolean;
  imageUrl?: string | null;
};

/** Imagen del producto (pestaña Avanzado). Se cambia desde "Editar". */
export function ProductDetailImageCard({
  canManage = false,
  imageUrl,
}: ProductDetailImageCardProps) {
  return (
    <ProductDetailSectionCard title="Imagen">
      <div className="flex flex-col gap-3 p-5">
        <div className="relative aspect-[4/3] w-full max-w-xs overflow-hidden rounded-xl border border-border bg-surface-container">
          <PosProductImage alt="Imagen del producto" imageUrl={imageUrl ?? undefined} />
        </div>
        {imageUrl ? null : (
          <p className="text-sm text-on-surface-variant">Este producto no tiene imagen.</p>
        )}
        {canManage ? (
          <p className="text-xs text-on-surface-variant">
            Para subir, cambiar o quitar la imagen usa «Editar».
          </p>
        ) : null}
      </div>
    </ProductDetailSectionCard>
  );
}
