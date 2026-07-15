"use client";

import { Plus, Truck } from "lucide-react";
import { useMemo, useState } from "react";

import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { ActionsMenu, type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { ErrorState } from "@/shared/components/ErrorState";
import { formatRefUsd } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";

import { EditSupplierProductModal } from "@/modules/contacts/components/supplier-products/EditSupplierProductModal";
import { LinkSupplierProductModal } from "@/modules/contacts/components/supplier-products/LinkSupplierProductModal";
import { RegisterSupplierPriceModal } from "@/modules/contacts/components/supplier-products/RegisterSupplierPriceModal";
import { SupplierProductOriginChip } from "@/modules/contacts/components/supplier-products/SupplierProductOriginChip";
import { SupplierProductPriceHistoryModal } from "@/modules/contacts/components/supplier-products/SupplierProductPriceHistoryModal";
import { SupplierProductStatusBadge } from "@/modules/contacts/components/supplier-products/SupplierProductStatusBadge";
import { SupplierProductVariationBadge } from "@/modules/contacts/components/supplier-products/SupplierProductVariationBadge";
import { UnlinkSupplierProductConfirmModal } from "@/modules/contacts/components/supplier-products/UnlinkSupplierProductConfirmModal";
import {
  formatSupplierProductPackUnitsSummary,
  ManageSupplierProductPackUnitsModal,
} from "@/modules/contacts/components/supplier-products/ManageSupplierProductPackUnitsModal";
import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";

import { ProductDetailSectionCard } from "./ProductDetailSectionCard";
import { ProductDetailSuppliersSummaryCards } from "./ProductDetailSuppliersSummaryCards";

export type ProductSupplierRow = SupplierProduct;

type ProductDetailSuppliersTableProps = {
  error?: Error | null;
  isLoading?: boolean;
  onRetry?: () => void;
  productId: string;
  productName?: string;
  productSku?: string;
  rows: ProductSupplierRow[];
  salePriceRef: number;
};

type ActiveModal = "edit" | "history" | "packUnits" | "register" | "unlink" | null;

export function ProductDetailSuppliersTable({
  error,
  isLoading = false,
  onRetry,
  productId,
  productName,
  productSku,
  rows,
  salePriceRef,
}: ProductDetailSuppliersTableProps) {
  const { can } = usePermission();
  const [selected, setSelected] = useState<SupplierProduct | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  const bestPriceId = useMemo(() => {
    const activeRows = rows.filter((row) => row.isActive !== false);
    if (activeRows.length === 0) return null;

    return [...activeRows].sort(
      (first, second) => (first.lastCostRef ?? 0) - (second.lastCostRef ?? 0),
    )[0]?.id;
  }, [rows]);

  function openModal(modal: ActiveModal, row: SupplierProduct) {
    setSelected(row);
    setActiveModal(modal);
  }

  function buildActions(row: SupplierProduct): ActionMenuItem[] {
    if (!can("products.manage") || row.isActive === false) {
      return can("products.view")
        ? [{ label: "Ver historial", onSelect: () => openModal("history", row) }]
        : [];
    }

    return [
      { label: "Registrar precio", onSelect: () => openModal("register", row) },
      { label: "Gestionar empaques", onSelect: () => openModal("packUnits", row) },
      { label: "Ver historial", onSelect: () => openModal("history", row) },
      { label: "Editar", onSelect: () => openModal("edit", row) },
      { label: "Desvincular", onSelect: () => openModal("unlink", row), variant: "danger" },
    ];
  }

  const showActions = can("products.manage") || can("products.view");

  return (
    <>
      <ProductDetailSectionCard
        headerAction={
          <Can permission="products.manage">
            <LinkSupplierProductModal
              productId={productId}
              productName={productName}
              productSku={productSku}
              supplierId=""
              trigger={
                <Button className="gap-1" size="sm" type="button" variant="ghost">
                  <Plus aria-hidden className="size-[1.125rem]" />
                  Vincular
                </Button>
              }
            />
          </Can>
        }
        title={
          <span className="flex items-center gap-2">
            <Truck aria-hidden className="size-5 text-on-surface-variant" />
            Proveedores asociados
          </span>
        }
      >
        <ProductDetailSuppliersSummaryCards rows={rows} salePriceRef={salePriceRef} />

        {error ? (
          <div className="px-5 py-6">
            <ErrorState
              description={error.message}
              onRetry={onRetry}
              title="No pudimos cargar los proveedores"
            />
          </div>
        ) : isLoading ? (
          <p className="px-5 py-8 text-center text-sm text-on-surface-variant">
            Cargando proveedores...
          </p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-on-surface-variant">
            Este producto no tiene proveedores vinculados.
          </p>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-container-low text-xs font-semibold text-on-surface-variant dark:border-slate-800">
                  <th className="px-5 py-3">Proveedor</th>
                  <th className="px-5 py-3">SKU proveedor</th>
                  <th className="px-5 py-3 text-right">Último costo (REF)</th>
                  <th className="px-5 py-3">Empaques</th>
                  <th className="px-5 py-3">Variación</th>
                  <th className="px-5 py-3">Última actualización</th>
                  <th className="px-5 py-3">Estado</th>
                  {showActions ? <th className="px-5 py-3 text-right">Acciones</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 dark:divide-slate-800">
                {rows.map((row) => {
                  const actions = buildActions(row);

                  return (
                    <tr
                      className="group transition-colors hover:bg-surface-bright/50 dark:hover:bg-slate-800/50"
                      key={row.id}
                    >
                      <td className="px-5 py-3 font-medium text-foreground">
                        <div className="flex flex-col gap-1">
                          <span>{row.supplier?.name ?? row.supplierId}</span>
                          {row.id === bestPriceId ? (
                            <span className="inline-flex w-fit rounded-full bg-secondary-container px-2 py-0.5 text-[0.625rem] font-bold uppercase text-on-secondary-container">
                              Más económico
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3 font-mono text-sm text-on-surface-variant">
                        {row.supplierSku ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-sm tabular-nums">
                        {formatRefUsd(row.lastCostRef ?? 0)}
                      </td>
                      <td className="px-5 py-3 text-sm text-on-surface-variant">
                        {formatSupplierProductPackUnitsSummary(row.packUnits)}
                      </td>
                      <td className="px-5 py-3">
                        <SupplierProductVariationBadge variationPercent={row.variationPercent} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-on-surface-variant">
                            {row.updatedAt
                              ? formatDateTimeShort(row.updatedAt)
                              : row.lastPurchasedAt
                                ? formatDateTimeShort(row.lastPurchasedAt)
                                : "—"}
                          </span>
                          <SupplierProductOriginChip origin={row.lastPriceOrigin} />
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <SupplierProductStatusBadge isActive={row.isActive} />
                      </td>
                      {showActions ? (
                        <td className="px-5 py-3 text-right">
                          {actions.length > 0 ? (
                            <div className="inline-flex opacity-100 transition-opacity group-hover:opacity-100 sm:opacity-70">
                              <ActionsMenu actions={actions} label="Gestionar proveedor" />
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ProductDetailSectionCard>

      <RegisterSupplierPriceModal
        onOpenChange={(open) => !open && setActiveModal(null)}
        open={activeModal === "register"}
        supplierProduct={selected}
      />
      <SupplierProductPriceHistoryModal
        onOpenChange={(open) => !open && setActiveModal(null)}
        onRegisterPrice={
          can("products.manage") && selected?.isActive !== false
            ? () => setActiveModal("register")
            : undefined
        }
        open={activeModal === "history"}
        supplierProduct={selected}
      />
      <EditSupplierProductModal
        onOpenChange={(open) => !open && setActiveModal(null)}
        open={activeModal === "edit"}
        supplierProduct={selected}
      />
      <ManageSupplierProductPackUnitsModal
        onOpenChange={(open) => !open && setActiveModal(null)}
        open={activeModal === "packUnits"}
        supplierProduct={selected}
      />
      <UnlinkSupplierProductConfirmModal
        onOpenChange={(open) => !open && setActiveModal(null)}
        open={activeModal === "unlink"}
        supplierProduct={selected}
      />
    </>
  );
}
