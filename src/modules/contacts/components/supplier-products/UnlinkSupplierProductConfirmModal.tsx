"use client";

import { useDeactivateSupplierProduct } from "@/modules/contacts/hooks/useSupplierProductMutations";
import { useSupplierProductPriceHistory } from "@/modules/contacts/hooks/useSupplierProductPriceHistory";
import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";
import { formatRefUsd } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import type {
  SupplierProduct,
  SupplierProductPriceHistoryEntry,
} from "../../types/supplierProducts";

type UnlinkSupplierProductConfirmModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  supplierProduct: SupplierProduct | null;
};

type PriceHistorySummary = {
  /** El registro más reciente; el historial llega ordenado del último al primero. */
  latest?: Pick<SupplierProductPriceHistoryEntry, "createdAt" | "newCostRef">;
  total: number;
};

function formatPriceHistorySummary({ latest, total }: PriceHistorySummary) {
  if (total === 0) {
    return "Sin registros";
  }

  const count = total === 1 ? "1 registro" : `${total} registros`;

  return latest
    ? `${count} · último ${formatRefUsd(latest.newCostRef)} el ${formatDate(latest.createdAt)}`
    : count;
}

/**
 * Lo que hace de verdad `deactivate_supplier_product`: solo pone el vínculo en
 * inactivo. No borra el historial de precios ni los empaques, y no toca las
 * compras; si el vínculo era el habitual, el trigger lo suelta y lo pasa a otro
 * proveedor activo del producto cuando lo hay.
 */
export function buildUnlinkSupplierProductEffects(
  supplierProduct: Pick<SupplierProduct, "isPreferred" | "packUnits">,
  history: PriceHistorySummary,
): ConfirmActionEffect[] {
  const activePackUnits = (supplierProduct.packUnits ?? []).filter((packUnit) => packUnit.isActive);

  return [
    { after: "Inactivo", before: "Activo", label: "Vínculo con el proveedor", tone: "warning" },
    ...(supplierProduct.isPreferred
      ? [
          {
            after: "Deja de serlo",
            before: "Habitual",
            label: "Proveedor habitual del producto",
            tone: "warning",
          } satisfies ConfirmActionEffect,
          {
            label:
              "El habitual pasa a otro proveedor activo del producto; si no hay ninguno, el producto queda sin habitual",
          },
        ]
      : []),
    {
      after: "Se conserva, sin uso",
      before: formatPriceHistorySummary(history),
      label: "Historial de precios de este proveedor",
    },
    ...(activePackUnits.length > 0
      ? activePackUnits.map(
          (packUnit): ConfirmActionEffect => ({
            after: "Se conserva, sin uso",
            before: `${packUnit.label} × ${packUnit.unitsPerPack} ${
              packUnit.unitsPerPack === 1 ? "unidad" : "unidades"
            }`,
            label: "Empaque del proveedor",
          }),
        )
      : [{ before: "Ninguno", label: "Empaques del proveedor" }]),
    { after: "No cambian", label: "Compras ya registradas" },
    {
      label:
        "Si vuelves a vincularlo o registras una compra de este producto al proveedor, el vínculo se reactiva con su historial y sus empaques",
    },
  ];
}

export function UnlinkSupplierProductConfirmModal({
  onOpenChange,
  onSuccess,
  open,
  supplierProduct,
}: UnlinkSupplierProductConfirmModalProps) {
  const deactivate = useDeactivateSupplierProduct(supplierProduct?.id ?? "");
  // Los hosts no traen el historial: se pide al abrir, solo el último registro y el total.
  const history = useSupplierProductPriceHistory(open ? supplierProduct?.id : undefined, {
    limit: 1,
  });

  let status: "ready" | "loading" | "error" = "ready";

  if (history.error) {
    status = "error";
  } else if (!history.data) {
    status = "loading";
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      deactivate.reset();
    }

    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    if (!supplierProduct) return;

    await deactivate.mutateAsync();
    handleOpenChange(false);
    onSuccess?.();
  }

  return (
    <ConfirmActionModal
      confirmLabel="Desvincular producto"
      description="El vínculo queda inactivo. No se borra el historial de precios ni los empaques."
      effects={
        supplierProduct && history.data
          ? buildUnlinkSupplierProductEffects(supplierProduct, {
              latest: history.data.items[0],
              total: history.data.total,
            })
          : undefined
      }
      error={deactivate.error instanceof Error ? deactivate.error.message : null}
      isPending={deactivate.isPending}
      onConfirm={handleConfirm}
      onOpenChange={handleOpenChange}
      onRetry={() => void history.refetch()}
      open={open}
      status={status}
      statusHint={status === "error" ? "No se ha cambiado nada." : undefined}
      statusMessage={
        status === "error"
          ? (history.error?.message ?? null)
          : "Consultando el historial de precios…"
      }
      title="Confirmar desvinculación"
      variant="danger"
    >
      <p>
        {supplierProduct?.product?.name ?? supplierProduct?.productId} dejará de aparecer en el catálogo
        activo de {supplierProduct?.supplier?.name ?? "este proveedor"}.
      </p>
    </ConfirmActionModal>
  );
}
