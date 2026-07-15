"use client";

import { Package, Trash2 } from "lucide-react";

import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";
import { formatRefUsd } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import type { PurchaseDraftItem, PurchaseLineCatalogMeta } from "../types";
import { getDraftSubtotalRef, syncPackDerivedFields } from "../utils/normalizePurchaseLine";
import { purchaseInlineInputClassName } from "../utils/purchaseCreateStyles";

export type PurchaseLineItemMeta = PurchaseLineCatalogMeta;

type PurchaseLineItemsTableProps = {
  getItemMeta: (productId: string) => PurchaseLineItemMeta;
  items: PurchaseDraftItem[];
  onRemoveItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, input: Partial<PurchaseDraftItem>) => void;
};

const CUSTOM_PACK_VALUE = "__custom__";

const STANDARD_PACK_LABELS = ["Bulto", "Paquete", "Caja"] as const;

type StandardPackLabel = (typeof STANDARD_PACK_LABELS)[number];

function normalizeStandardPackLabel(label: string): StandardPackLabel {
  const match = STANDARD_PACK_LABELS.find(
    (option) => option.toLowerCase() === label.trim().toLowerCase(),
  );

  return match ?? "Bulto";
}

function isCustomPackLine(item: PurchaseDraftItem) {
  return item.entryMode === "pack" && !item.packUnitId;
}
function applyPackPreset(item: PurchaseDraftItem, packUnit: SupplierProductPackUnit | null) {
  if (!packUnit) {
    return syncPackDerivedFields({
      ...item,
      entryMode: "pack",
      packLabel: normalizeStandardPackLabel(item.packLabel || "Bulto"),
      packUnitId: undefined,
    });
  }

  const packCostRef =
    item.unitCostRef > 0
      ? Math.round(item.unitCostRef * packUnit.unitsPerPack * 100) / 100
      : item.packCostRef;

  return syncPackDerivedFields({
    ...item,
    entryMode: "pack",
    packCostRef,
    packLabel: packUnit.label,
    packUnitId: packUnit.id,
    unitsPerPack: packUnit.unitsPerPack,
  });
}

export function PurchaseLineItemsTable({
  getItemMeta,
  items,
  onRemoveItem,
  onUpdateItem,
}: PurchaseLineItemsTableProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <Package aria-hidden className="size-10 text-muted-foreground/60" />
        <p className="text-sm font-medium text-foreground">Sin productos agregados</p>
        <p className="text-xs text-on-surface-variant">
          Busca o escanea un producto para agregarlo a la compra.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-left text-sm">
        <thead>
          <tr className="sticky top-0 z-10 border-b border-border bg-surface-container-low shadow-sm dark:border-slate-800">
            <th className="px-4 py-3 text-xs font-semibold text-on-surface-variant">Producto</th>
            <th className="w-36 min-w-[9rem] px-4 py-3 text-xs font-semibold text-on-surface-variant">
              Modo
            </th>
            <th className="w-24 px-4 py-3 text-center text-xs font-semibold text-on-surface-variant">
              Cant.
            </th>
            <th className="w-36 px-4 py-3 text-right text-xs font-semibold text-on-surface-variant">
              Costo (REF)
            </th>
            <th className="w-32 px-4 py-3 text-right text-xs font-semibold text-on-surface-variant">
              Subtotal (REF)
            </th>
            <th className="w-12 px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50 dark:divide-slate-800">
          {items.map((item, index) => {
            const meta = getItemMeta(item.productId);
            const normalized = syncPackDerivedFields(item);
            const subtotal = getDraftSubtotalRef(normalized);
            const packUnits = meta.packUnits ?? [];
            const selectValue =
              item.entryMode === "pack" && item.packUnitId
                ? item.packUnitId
                : item.entryMode === "pack"
                  ? CUSTOM_PACK_VALUE
                  : "unit";

            return (
              <tr
                className={cn(
                  "align-top transition-colors hover:bg-surface-container-low/50",
                  index % 2 === 1 && "bg-surface-bright/50 dark:bg-slate-900/30",
                )}
                key={item.id}
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">{meta.name}</span>
                    <span className="text-xs text-on-surface-variant">{meta.sku}</span>
                    {item.entryMode === "pack" ? (
                      <span className="mt-1 text-xs text-on-surface-variant">
                        → {normalized.quantity} u · {formatRefUsd(normalized.unitCostRef)}/u
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="w-36 min-w-[9rem] px-4 py-3">
                  <select
                    aria-label={`Modo de captura de ${meta.name}`}
                    className={cn(purchaseInlineInputClassName, "h-8 w-full text-xs")}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "unit") {
                        onUpdateItem(item.id, {
                          entryMode: "unit",
                          quantity: Math.max(1, normalized.quantity || 1),
                        });
                        return;
                      }

                      if (value === CUSTOM_PACK_VALUE) {
                        onUpdateItem(
                          item.id,
                          applyPackPreset(
                            {
                              ...item,
                              entryMode: "pack",
                              packCount: item.packCount || 1,
                              packLabel: normalizeStandardPackLabel(item.packLabel),
                              unitsPerPack: item.unitsPerPack || 1,
                            },
                            null,
                          ),
                        );
                        return;
                      }

                      const packUnit = packUnits.find((entry) => entry.id === value);
                      if (packUnit) {
                        onUpdateItem(item.id, applyPackPreset(item, packUnit));
                      }
                    }}
                    value={selectValue}
                  >
                    <option value="unit">Unidad</option>
                    {packUnits.map((packUnit) => (
                      <option key={packUnit.id} value={packUnit.id}>
                        {packUnit.label} ({packUnit.unitsPerPack} u)
                      </option>
                    ))}
                    <option value={CUSTOM_PACK_VALUE}>Personalizado</option>
                  </select>
                  {isCustomPackLine(item) ? (
                    <select
                      aria-label={`Tipo de empaque de ${meta.name}`}
                      className={cn(
                        purchaseInlineInputClassName,
                        "mt-2 h-8 w-full text-xs",
                      )}
                      onChange={(event) =>
                        onUpdateItem(
                          item.id,
                          syncPackDerivedFields({
                            ...item,
                            packLabel: event.target.value,
                          }),
                        )
                      }
                      value={normalizeStandardPackLabel(item.packLabel)}
                    >
                      {STANDARD_PACK_LABELS.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-center">
                    {item.entryMode === "unit" ? (
                      <input
                        aria-label={`Cantidad de ${meta.name}`}
                        className={cn(purchaseInlineInputClassName, "h-8 w-16 text-center")}
                        min={1}
                        onChange={(event) =>
                          onUpdateItem(item.id, {
                            quantity: Math.max(1, Number(event.target.value) || 1),
                          })
                        }
                        type="number"
                        value={item.quantity}
                      />
                    ) : (
                      <div className="flex flex-col gap-2">
                        <input
                          aria-label={`Empaques de ${meta.name}`}
                          className={cn(purchaseInlineInputClassName, "h-8 w-16 text-center")}
                          min={1}
                          onChange={(event) =>
                            onUpdateItem(
                              item.id,
                              syncPackDerivedFields({
                                ...item,
                                packCount: Math.max(1, Number(event.target.value) || 1),
                              }),
                            )
                          }
                          type="number"
                          value={item.packCount}
                        />
                        <input
                          aria-label={`Unidades por empaque de ${meta.name}`}
                          className={cn(purchaseInlineInputClassName, "h-8 w-16 text-center")}
                          min={1}
                          onChange={(event) =>
                            onUpdateItem(
                              item.id,
                              syncPackDerivedFields({
                                ...item,
                                packUnitId: undefined,
                                unitsPerPack: Math.max(1, Number(event.target.value) || 1),
                              }),
                            )
                          }
                          type="number"
                          value={item.unitsPerPack}
                        />
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {item.entryMode === "unit" ? (
                    <input
                      aria-label={`Costo REF de ${meta.name}`}
                      className={cn(purchaseInlineInputClassName, "h-8 w-full text-right")}
                      min={0}
                      onChange={(event) =>
                        onUpdateItem(item.id, {
                          unitCostRef: Math.max(0, Number(event.target.value) || 0),
                        })
                      }
                      step="0.01"
                      type="number"
                      value={item.unitCostRef}
                    />
                  ) : (
                    <input
                      aria-label={`Costo por empaque REF de ${meta.name}`}
                      className={cn(purchaseInlineInputClassName, "h-8 w-full text-right")}
                      min={0}
                      onChange={(event) =>
                        onUpdateItem(
                          item.id,
                          syncPackDerivedFields({
                            ...item,
                            packCostRef: Math.max(0, Number(event.target.value) || 0),
                          }),
                        )
                      }
                      step="0.01"
                      type="number"
                      value={item.packCostRef}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                  {formatRefUsd(subtotal)}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    aria-label={`Quitar ${meta.name}`}
                    className="cursor-pointer rounded-full p-1 text-outline transition-colors hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950/40"
                    onClick={() => onRemoveItem(item.id)}
                    type="button"
                  >
                    <Trash2 aria-hidden className="size-[1.125rem]" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
