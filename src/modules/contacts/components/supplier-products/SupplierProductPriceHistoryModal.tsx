"use client";

import { useMemo } from "react";

import { useSupplierProductPriceHistory } from "@/modules/contacts/hooks/useSupplierProductPriceHistory";
import { getPaginatedItems } from "@/lib/api/pagination";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { formatRefUsd } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";

import { SupplierProductOriginChip } from "./SupplierProductOriginChip";
import { SupplierProductVariationBadge } from "./SupplierProductVariationBadge";

import type { SupplierProduct } from "../../types/supplierProducts";

type SupplierProductPriceHistoryModalProps = {
  onOpenChange: (open: boolean) => void;
  onRegisterPrice?: () => void;
  open: boolean;
  supplierProduct: SupplierProduct | null;
};

export function SupplierProductPriceHistoryModal({
  onOpenChange,
  onRegisterPrice,
  open,
  supplierProduct,
}: SupplierProductPriceHistoryModalProps) {
  const history = useSupplierProductPriceHistory(supplierProduct?.id, { limit: 50 });
  const rows = useMemo(() => getPaginatedItems(history.data), [history.data]);

  return (
    <Modal
      contentClassName="sm:max-w-3xl"
      description={
        supplierProduct
          ? `${supplierProduct.supplier?.name ?? "Proveedor"} · ${supplierProduct.product?.name ?? supplierProduct.productId}`
          : "Consulta las variaciones registradas para esta relación proveedor-producto."
      }
      footer={({ close }) => (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button onClick={close} type="button" variant="outline">
            Cerrar
          </Button>
          {onRegisterPrice ? (
            <Button onClick={onRegisterPrice} type="button">
              Registrar precio
            </Button>
          ) : null}
        </div>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Historial de precios"
    >
      {history.isLoading ? (
        <p className="py-8 text-center text-sm text-on-surface-variant">Cargando historial...</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-on-surface-variant">
          Aún no hay registros de precio para esta relación.
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-outline-variant">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3 text-right">Anterior</th>
                <th className="px-4 py-3 text-right">Nuevo</th>
                <th className="px-4 py-3">Variación</th>
                <th className="px-4 py-3">Origen</th>
                <th className="px-4 py-3">Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {formatDateTimeShort(row.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {row.oldCostRef != null ? formatRefUsd(row.oldCostRef) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatRefUsd(row.newCostRef)}
                  </td>
                  <td className="px-4 py-3">
                    <SupplierProductVariationBadge variationPercent={row.variationPercent} />
                  </td>
                  <td className="px-4 py-3">
                    <SupplierProductOriginChip origin={row.origin} />
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{row.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
