"use client";

import { Package, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";
import { formatRefUsd, formatVesBs, roundMoney, refToVes, vesToRef } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import type { PurchaseCostCurrency, PurchaseDraftItem, PurchaseLineCatalogMeta } from "../types";
import {
  getDraftSubtotalRef,
  getDraftSubtotalVes,
  getDraftTotalWithTax,
  syncLineCostFields,
} from "../utils/normalizePurchaseLine";
import {
  purchaseLineFieldBoxClassName,
  purchaseLineFieldBoxLockedClassName,
  purchaseLineFieldControlClassName,
  purchaseLineFieldLabelClassName,
  purchaseLineFieldSelectClassName,
} from "../utils/purchaseCreateStyles";

export type PurchaseLineItemMeta = PurchaseLineCatalogMeta;

type PurchaseLineItemsTableProps = {
  getItemMeta: (productId: string) => PurchaseLineItemMeta;
  items: PurchaseDraftItem[];
  onRemoveItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, input: Partial<PurchaseDraftItem>) => void;
  rateVes: number;
};

const CUSTOM_PACK_VALUE = "__custom__";

const STANDARD_PACK_LABELS = ["Bulto", "Paquete", "Caja", "Manga"] as const;

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

function resolvePackCostFromItem(item: PurchaseDraftItem, unitsPerPack: number, rateVes: number) {
  if (item.costCurrency === "ves") {
    if (item.entryMode === "pack" && item.packCostVes > 0) {
      return { packCostRef: roundMoney(vesToRef(item.packCostVes, rateVes)), packCostVes: item.packCostVes };
    }
    if (item.unitCostVes > 0) {
      const packCostVes = roundMoney(item.unitCostVes * unitsPerPack);
      return { packCostRef: roundMoney(vesToRef(packCostVes, rateVes)), packCostVes };
    }
  }

  if (item.entryMode === "pack" && item.packCostRef > 0) {
    return {
      packCostRef: item.packCostRef,
      packCostVes: roundMoney(refToVes(item.packCostRef, rateVes)),
    };
  }

  if (item.unitCostRef > 0) {
    const packCostRef = roundMoney(item.unitCostRef * unitsPerPack);
    return {
      packCostRef,
      packCostVes: roundMoney(refToVes(packCostRef, rateVes)),
    };
  }

  return {
    packCostRef: Math.max(0, item.packCostRef),
    packCostVes: Math.max(0, item.packCostVes),
  };
}

function applyPackPreset(
  item: PurchaseDraftItem,
  packUnit: SupplierProductPackUnit | null,
  rateVes: number,
) {
  if (!packUnit) {
    const unitsPerPack = Math.max(1, item.unitsPerPack || 1);
    const costs = resolvePackCostFromItem(item, unitsPerPack, rateVes);
    return syncLineCostFields(
      {
        ...item,
        entryMode: "pack",
        packCostRef: costs.packCostRef,
        packCostVes: costs.packCostVes,
        packCount: Math.max(1, item.packCount || 1),
        packLabel: normalizeStandardPackLabel(item.packLabel || "Bulto"),
        packUnitId: undefined,
        unitsPerPack,
      },
      rateVes,
    );
  }

  const costs = resolvePackCostFromItem(item, packUnit.unitsPerPack, rateVes);
  return syncLineCostFields(
    {
      ...item,
      entryMode: "pack",
      packCostRef: costs.packCostRef,
      packCostVes: costs.packCostVes,
      packCount: Math.max(1, item.packCount || 1),
      packLabel: packUnit.label,
      packUnitId: packUnit.id,
      unitsPerPack: packUnit.unitsPerPack,
    },
    rateVes,
  );
}

function LineFieldBox({
  align = "left",
  children,
  label,
  locked = false,
}: {
  align?: "left" | "center" | "right";
  children: ReactNode;
  label: string;
  locked?: boolean;
}) {
  return (
    <div className={locked ? purchaseLineFieldBoxLockedClassName : purchaseLineFieldBoxClassName}>
      <span
        className={cn(
          purchaseLineFieldLabelClassName,
          align === "center" && "text-center",
          align === "right" && "text-right",
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/** Dos montos apilados: BS (principal) + REF/USD (secundario). */
function DualMoneyStack({
  align = "right",
  refAmount,
  vesAmount,
}: {
  align?: "left" | "right";
  refAmount: number;
  vesAmount: number;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0 leading-tight",
        align === "right" ? "items-end text-right" : "items-start text-left",
      )}
    >
      <span className="font-mono text-sm tabular-nums text-foreground">
        {formatVesBs(vesAmount)}
      </span>
      <span className="font-mono text-[0.7rem] tabular-nums text-on-surface-variant">
        {formatRefUsd(refAmount)}
      </span>
    </div>
  );
}

function CostCurrencyToggle({
  onChange,
  productName,
  value,
}: {
  onChange: (currency: PurchaseCostCurrency) => void;
  productName: string;
  value: PurchaseCostCurrency;
}) {
  return (
    <div
      aria-label={`Moneda de costo de ${productName}`}
      className="inline-flex w-fit shrink-0 rounded-md border border-border p-0.5 dark:border-slate-700"
      role="group"
    >
      {(["ves", "ref"] as const).map((currency) => {
        const active = value === currency;
        return (
          <button
            className={cn(
              "cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide uppercase transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-on-surface-variant hover:bg-surface-container-low",
            )}
            key={currency}
            onClick={() => onChange(currency)}
            type="button"
          >
            {currency === "ves" ? "BS" : "REF"}
          </button>
        );
      })}
    </div>
  );
}

export function PurchaseLineItemsTable({
  getItemMeta,
  items,
  onRemoveItem,
  onUpdateItem,
  rateVes,
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
      <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
        <thead>
          <tr className="sticky top-0 z-10 border-b border-border bg-surface-container-low shadow-sm dark:border-slate-800">
            <th className="px-4 py-3 text-xs font-semibold text-on-surface-variant">Producto</th>
            <th className="w-44 min-w-[11rem] px-4 py-3 text-xs font-semibold text-on-surface-variant">
              Modo
            </th>
            <th className="w-32 px-4 py-3 text-center text-xs font-semibold text-on-surface-variant">
              Cant.
            </th>
            <th className="w-52 px-4 py-3 text-right text-xs font-semibold text-on-surface-variant">
              Costo
            </th>
            <th className="w-52 px-4 py-3 text-right text-xs font-semibold text-on-surface-variant">
              Totales
            </th>
            <th className="w-12 px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50 dark:divide-slate-800">
          {items.map((item, index) => {
            const meta = getItemMeta(item.productId);
            const normalized = syncLineCostFields(item, rateVes);
            const subtotalRef = getDraftSubtotalRef(normalized);
            const subtotalVes = getDraftSubtotalVes(normalized);
            const packUnits = meta.packUnits ?? [];
            const packLabel = isCustomPackLine(item)
              ? normalizeStandardPackLabel(item.packLabel || "Bulto")
              : item.packLabel.trim() || "Empaque";
            const selectValue =
              item.entryMode === "pack" && item.packUnitId
                ? item.packUnitId
                : item.entryMode === "pack"
                  ? CUSTOM_PACK_VALUE
                  : "unit";
            const isVes = item.costCurrency === "ves";
            const taxRate = item.taxRate ?? meta.taxRate ?? 0;
            const totalWithTaxRef = getDraftTotalWithTax(subtotalRef, taxRate);
            const totalWithTaxVes = getDraftTotalWithTax(subtotalVes, taxRate);

            return (
              <tr
                className={cn(
                  "align-top transition-colors hover:bg-surface-container-low/50",
                  index % 2 === 1 && "bg-surface-bright/50 dark:bg-slate-900/30",
                )}
                key={item.id}
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{meta.name}</span>
                      <span className="text-xs text-on-surface-variant">{meta.sku}</span>
                      {item.entryMode === "pack" ? (
                        <span className="mt-1 text-xs text-on-surface-variant">
                          → {normalized.quantity} u totales
                        </span>
                      ) : null}
                    </div>
                    <CostCurrencyToggle
                      onChange={(currency) =>
                        onUpdateItem(item.id, { costCurrency: currency })
                      }
                      productName={meta.name}
                      value={item.costCurrency}
                    />
                    <LineFieldBox align="left" label="Impuesto" locked>
                      <p className="h-7 text-xs leading-7 tabular-nums text-foreground">
                        {taxRate}%
                      </p>
                    </LineFieldBox>
                  </div>
                </td>
                <td className="w-44 min-w-[11rem] px-4 py-3">
                  <div className="flex flex-col gap-2">
                    <LineFieldBox label="Modo">
                      <select
                        aria-label={`Modo de captura de ${meta.name}`}
                        className={purchaseLineFieldSelectClassName}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "unit") {
                            onUpdateItem(
                              item.id,
                              syncLineCostFields(
                                {
                                  ...item,
                                  entryMode: "unit",
                                  quantity: Math.max(1, normalized.quantity || 1),
                                  unitCostRef: normalized.unitCostRef,
                                  unitCostVes: normalized.unitCostVes,
                                },
                                rateVes,
                              ),
                            );
                            return;
                          }

                          if (value === CUSTOM_PACK_VALUE) {
                            onUpdateItem(item.id, applyPackPreset(item, null, rateVes));
                            return;
                          }

                          const packUnit = packUnits.find((entry) => entry.id === value);
                          if (packUnit) {
                            onUpdateItem(item.id, applyPackPreset(item, packUnit, rateVes));
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
                    </LineFieldBox>
                    {isCustomPackLine(item) ? (
                      <LineFieldBox label="Tipo">
                        <select
                          aria-label={`Tipo de empaque de ${meta.name}`}
                          className={purchaseLineFieldSelectClassName}
                          onChange={(event) =>
                            onUpdateItem(
                              item.id,
                              syncLineCostFields(
                                {
                                  ...item,
                                  packLabel: event.target.value,
                                },
                                rateVes,
                              ),
                            )
                          }
                          value={packLabel}
                        >
                          {STANDARD_PACK_LABELS.map((label) => (
                            <option key={label} value={label}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </LineFieldBox>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-2">
                    {item.entryMode === "unit" ? (
                      <LineFieldBox align="center" label="Cantidad">
                        <input
                          aria-label={`Cantidad de ${meta.name}`}
                          className={cn(purchaseLineFieldControlClassName, "text-center")}
                          min={1}
                          onChange={(event) =>
                            onUpdateItem(
                              item.id,
                              syncLineCostFields(
                                {
                                  ...item,
                                  quantity: Math.max(1, Number(event.target.value) || 1),
                                },
                                rateVes,
                              ),
                            )
                          }
                          type="number"
                          value={item.quantity}
                        />
                      </LineFieldBox>
                    ) : (
                      <>
                        <LineFieldBox align="center" label={`${packLabel}s`}>
                          <input
                            aria-label={`Cantidad de ${packLabel.toLowerCase()} de ${meta.name}`}
                            className={cn(purchaseLineFieldControlClassName, "text-center")}
                            min={1}
                            onChange={(event) =>
                              onUpdateItem(
                                item.id,
                                syncLineCostFields(
                                  {
                                    ...item,
                                    packCount: Math.max(1, Number(event.target.value) || 1),
                                  },
                                  rateVes,
                                ),
                              )
                            }
                            type="number"
                            value={item.packCount}
                          />
                        </LineFieldBox>
                        {isCustomPackLine(item) ? (
                          <LineFieldBox align="center" label={`Uds / ${packLabel}`}>
                            <input
                              aria-label={`Unidades por ${packLabel.toLowerCase()} de ${meta.name}`}
                              className={cn(purchaseLineFieldControlClassName, "text-center")}
                              min={1}
                              onChange={(event) =>
                                onUpdateItem(
                                  item.id,
                                  syncLineCostFields(
                                    {
                                      ...item,
                                      packUnitId: undefined,
                                      unitsPerPack: Math.max(1, Number(event.target.value) || 1),
                                    },
                                    rateVes,
                                  ),
                                )
                              }
                              type="number"
                              value={item.unitsPerPack}
                            />
                          </LineFieldBox>
                        ) : (
                          <LineFieldBox align="center" label={`Uds / ${packLabel}`} locked>
                            <p className="h-7 text-center text-xs leading-7 tabular-nums text-foreground">
                              {item.unitsPerPack}
                            </p>
                          </LineFieldBox>
                        )}
                      </>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-2">
                    {item.entryMode === "unit" ? (
                      <>
                        <LineFieldBox
                          align="right"
                          label={isVes ? "Costo unitario BS" : "Costo unitario REF"}
                        >
                          <input
                            aria-label={`Costo unitario ${isVes ? "BS" : "REF"} de ${meta.name}`}
                            className={cn(purchaseLineFieldControlClassName, "text-right")}
                            min={0}
                            onChange={(event) => {
                              const value = Math.max(0, Number(event.target.value) || 0);
                              onUpdateItem(
                                item.id,
                                syncLineCostFields(
                                  isVes
                                    ? { ...item, unitCostVes: value }
                                    : { ...item, unitCostRef: value },
                                  rateVes,
                                ),
                              );
                            }}
                            step="0.01"
                            type="number"
                            value={isVes ? item.unitCostVes : item.unitCostRef}
                          />
                        </LineFieldBox>
                        <LineFieldBox
                          align="right"
                          label={isVes ? "Unitario REF (auto)" : "Unitario BS (auto)"}
                          locked
                        >
                          <p className="h-7 text-right text-xs leading-7 tabular-nums text-foreground">
                            {isVes
                              ? formatRefUsd(normalized.unitCostRef)
                              : formatVesBs(normalized.unitCostVes)}
                          </p>
                        </LineFieldBox>
                      </>
                    ) : (
                      <>
                        <LineFieldBox
                          align="right"
                          label={
                            isVes
                              ? `Costo ${packLabel.toLowerCase()} BS`
                              : `Costo ${packLabel.toLowerCase()} REF`
                          }
                        >
                          <input
                            aria-label={`Costo por ${packLabel.toLowerCase()} ${isVes ? "BS" : "REF"} de ${meta.name}`}
                            className={cn(purchaseLineFieldControlClassName, "text-right")}
                            min={0}
                            onChange={(event) => {
                              const value = Math.max(0, Number(event.target.value) || 0);
                              onUpdateItem(
                                item.id,
                                syncLineCostFields(
                                  isVes
                                    ? { ...item, packCostVes: value }
                                    : { ...item, packCostRef: value },
                                  rateVes,
                                ),
                              );
                            }}
                            step="0.01"
                            type="number"
                            value={isVes ? item.packCostVes : item.packCostRef}
                          />
                        </LineFieldBox>
                        <LineFieldBox
                          align="right"
                          label={
                            isVes
                              ? `Costo ${packLabel.toLowerCase()} REF`
                              : `Costo ${packLabel.toLowerCase()} BS`
                          }
                          locked
                        >
                          <p className="h-7 text-right text-xs leading-7 tabular-nums text-foreground">
                            {isVes
                              ? formatRefUsd(normalized.packCostRef)
                              : formatVesBs(normalized.packCostVes)}
                          </p>
                        </LineFieldBox>
                        <LineFieldBox
                          align="right"
                          label={isVes ? "Unitario BS (auto)" : "Unitario REF (auto)"}
                          locked
                        >
                          <p className="h-7 text-right text-xs leading-7 tabular-nums text-foreground">
                            {isVes
                              ? formatVesBs(normalized.unitCostVes)
                              : formatRefUsd(normalized.unitCostRef)}
                          </p>
                        </LineFieldBox>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex min-w-[9.5rem] flex-col gap-1.5">
                    <LineFieldBox align="right" label="Subtotal" locked>
                      <DualMoneyStack refAmount={subtotalRef} vesAmount={subtotalVes} />
                    </LineFieldBox>
                    <LineFieldBox
                      align="right"
                      label={taxRate > 0 ? `Total (${taxRate}%)` : "Total"}
                      locked
                    >
                      <DualMoneyStack
                        refAmount={totalWithTaxRef}
                        vesAmount={totalWithTaxVes}
                      />
                    </LineFieldBox>
                  </div>
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
