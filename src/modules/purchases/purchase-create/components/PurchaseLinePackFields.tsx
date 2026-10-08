"use client";

import { cn } from "@/shared/utils/cn";

import type { PurchaseDraftItem, PurchaseLineCatalogMeta } from "../types";
import { syncLineCostFields } from "../utils/normalizePurchaseLine";
import {
  purchaseLineFieldControlClassName,
  purchaseLineFieldSelectClassName,
} from "../utils/purchaseCreateStyles";
import {
  applyCustomPackLabel,
  applyPackPreset,
  isCustomPackLine,
  normalizeStandardPackLabel,
  STANDARD_PACK_LABELS,
} from "../utils/purchaseLinePack";
import { PurchaseLineFieldBox } from "./PurchaseLineFieldBox";
import { PurchaseLineNumberCell } from "./PurchaseLineNumberCell";

type PurchaseLinePackFieldsProps = {
  className?: string;
  /** Línea en modo empaque (`entryMode: "pack"`). */
  item: PurchaseDraftItem;
  meta: PurchaseLineCatalogMeta;
  /** Recibe la línea completa ya sincronizada. */
  onUpdate: (next: PurchaseDraftItem) => void;
  rateVes: number;
};

const CUSTOM_PACK_PREFIX = "custom:";

/**
 * Los cuatro campos de una línea en modo empaque: tipo, empaques, unidades por
 * empaque y costo por empaque (en la moneda de la compra).
 */
export function PurchaseLinePackFields({
  className,
  item,
  meta,
  onUpdate,
  rateVes,
}: PurchaseLinePackFieldsProps) {
  const packUnits = meta.packUnits ?? [];
  const isCustom = isCustomPackLine(item);
  const isVes = item.costCurrency === "ves";
  const currencyLabel = isVes ? "BS" : "REF";
  const packLabel = isCustom
    ? normalizeStandardPackLabel(item.packLabel || "Bulto")
    : item.packLabel.trim() || "Empaque";
  const packNoun = packLabel.toLowerCase();

  function handlePackTypeChange(value: string) {
    if (value.startsWith(CUSTOM_PACK_PREFIX)) {
      const label = normalizeStandardPackLabel(value.slice(CUSTOM_PACK_PREFIX.length));
      onUpdate(applyCustomPackLabel(item, label, rateVes));
      return;
    }

    const packUnit = packUnits.find((entry) => entry.id === value);
    if (packUnit) {
      onUpdate(applyPackPreset(item, packUnit, rateVes));
    }
  }

  return (
    <div className={cn("grid grid-cols-2 gap-2 @xl:grid-cols-4", className)}>
      <PurchaseLineFieldBox label="Tipo de empaque">
        <select
          aria-label={`Tipo de empaque de ${meta.name}`}
          className={purchaseLineFieldSelectClassName}
          onChange={(event) => handlePackTypeChange(event.target.value)}
          value={isCustom ? `${CUSTOM_PACK_PREFIX}${packLabel}` : item.packUnitId}
        >
          {packUnits.map((packUnit) => (
            <option key={packUnit.id} value={packUnit.id}>
              {packUnit.label} ({packUnit.unitsPerPack} u)
            </option>
          ))}
          {STANDARD_PACK_LABELS.map((label) => (
            <option key={label} value={`${CUSTOM_PACK_PREFIX}${label}`}>
              {packUnits.length > 0 ? `${label} (personalizado)` : label}
            </option>
          ))}
        </select>
      </PurchaseLineFieldBox>
      <PurchaseLineFieldBox align="center" label={`${packLabel}s`}>
        <PurchaseLineNumberCell
          aria-label={`Cantidad de ${packNoun} de ${meta.name}`}
          className={cn(purchaseLineFieldControlClassName, "text-center")}
          integer
          onChange={(packCount) => onUpdate(syncLineCostFields({ ...item, packCount }, rateVes))}
          value={item.packCount}
        />
      </PurchaseLineFieldBox>
      {isCustom ? (
        <PurchaseLineFieldBox align="center" label={`Uds / ${packLabel}`}>
          <PurchaseLineNumberCell
            aria-label={`Unidades por ${packNoun} de ${meta.name}`}
            className={cn(purchaseLineFieldControlClassName, "text-center")}
            integer
            onChange={(unitsPerPack) =>
              onUpdate(
                syncLineCostFields({ ...item, packUnitId: undefined, unitsPerPack }, rateVes),
              )
            }
            value={item.unitsPerPack}
          />
        </PurchaseLineFieldBox>
      ) : (
        <PurchaseLineFieldBox align="center" label={`Uds / ${packLabel}`} locked>
          <p className="h-7 text-center text-xs leading-7 tabular-nums text-foreground">
            {item.unitsPerPack}
          </p>
        </PurchaseLineFieldBox>
      )}
      <PurchaseLineFieldBox align="right" label={`Costo ${packNoun} ${currencyLabel}`}>
        <PurchaseLineNumberCell
          aria-label={`Costo por ${packNoun} ${currencyLabel} de ${meta.name}`}
          className={cn(purchaseLineFieldControlClassName, "text-right")}
          onChange={(value) =>
            onUpdate(
              syncLineCostFields(
                isVes ? { ...item, packCostVes: value } : { ...item, packCostRef: value },
                rateVes,
              ),
            )
          }
          value={isVes ? item.packCostVes : item.packCostRef}
        />
      </PurchaseLineFieldBox>
    </div>
  );
}
