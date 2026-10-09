"use client";

import { Loader2, TrendingDown, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";

import { PackDistributionFields } from "@/modules/inventory/inventory-movements/components/PackDistributionFields";
import type { PackDistributionValue } from "@/modules/inventory/inventory-movements/utils/packDistribution";
import { Button } from "@/shared/components/Button";

import {
  ConfirmActionModal,
  type ConfirmActionStatus,
} from "@/shared/components/ConfirmActionModal";
import { MarginBadge } from "@/shared/components/MarginBadge";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd } from "@/shared/utils/currency";
import { bandDrop, marginBand, type MarginThresholds, markupPct } from "@/shared/utils/pricing";

import {
  PurchaseImpactBeforeAfter,
  PurchaseImpactBlockingProducts,
  PurchaseImpactNotice,
} from "../../components/PurchaseImpactSummary";
import { PurchaseToggleSwitch } from "../../purchase-create/components/PurchaseToggleSwitch";
import type { PurchaseImpact, PurchaseImpactStockLine } from "../../services/purchaseImpact";
import type { ReceivePreviewDisassemble, ReceivePreviewLine } from "../utils/buildReceivePreview";

/**
 * Efecto real de la recepción (`GET /api/purchases/{id}/impact?action=receive`
 * con la lista de desarme que el modal va a enviar) y en qué estado está.
 */
export type PurchaseReceiveEffect = {
  /** El efecto a la vista; `null` mientras carga por primera vez o si falló. */
  impact: PurchaseImpact | null;
  /** Mensaje del error al calcular el efecto; el motivo de un bloqueo sale de `impact.reason`. */
  message?: string | null;
  onRetry?: () => void;
  /**
   * El usuario cambió marcas o reparto y el efecto se está volviendo a pedir:
   * `impact` es el anterior y no se puede confirmar hasta que llegue el nuevo.
   */
  recalculating?: boolean;
  status: ConfirmActionStatus;
};

type PurchaseReceivePreviewModalProps = {
  /** Lo tecleado en «Ajustar reparto», por línea; sin entrada, la receta. */
  distributionValues?: Readonly<Record<string, PackDistributionValue>>;
  /** Stock y costo que la recepción dejará de verdad; sin efecto permitido no hay botón de recibir. */
  effect: PurchaseReceiveEffect;
  /** Mensaje del servidor al fallar la recepción; se muestra tal cual. */
  error?: string | null;
  isPending?: boolean;
  lines: ReceivePreviewLine[];
  onConfirm: () => void | Promise<void>;
  /**
   * El usuario marcó o desmarcó «Desarmar al recibir» en una línea (COM-14). Sin
   * este manejador las líneas muestran el desarme pero no dejan cambiarlo.
   */
  onDisassembleChange?: (purchaseItemId: string, disassemble: boolean) => void;
  /**
   * El usuario ajustó el reparto de un surtido que se desarma (COM-14): texto de
   * cada campo por id de componente; `{}` = volver a la receta. Sin este
   * manejador las líneas no ofrecen «Ajustar reparto».
   */
  onDistributionChange?: (purchaseItemId: string, value: PackDistributionValue) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  purchaseNumber: string;
  /**
   * Precio de venta (REF) por id de producto: con él se avisa de los productos
   * cuya ganancia baja de banda con el costo nuevo. Sin precio no hay aviso.
   */
  salePrices?: Readonly<Record<string, number>>;
  /** Cortes del semáforo de ganancia de la tienda; sin ellos, los por defecto. */
  thresholds?: MarginThresholds;
};

const NO_DISTRIBUTION: PackDistributionValue = {};

const noticeClassName =
  "flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300";
const sectionTitleClassName =
  "text-xs font-semibold uppercase tracking-wide text-on-surface-variant";

function quantityInLabel(line: ReceivePreviewLine) {
  if (line.packCount && line.unitsPerPack) {
    return `${line.packCount} × ${line.unitsPerPack} = ${line.quantityIn} un`;
  }

  return `${line.quantityIn} un`;
}

/** Segundo efecto de la línea: los empaques salen y entran sus componentes. */
function DisassembleEffects({ effects, name }: { effects: ReceivePreviewDisassemble; name: string }) {
  return (
    <div className="space-y-1.5 rounded-md bg-surface-container-low px-3 py-2">
      <p className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-on-surface-variant">Se abren (salen del empaque)</span>
        <span className="shrink-0 font-medium tabular-nums text-foreground">
          −{effects.packsOut} {effects.packsOut === 1 ? "empaque" : "empaques"}
        </span>
      </p>
      <ul aria-label={`Componentes que entran al desarmar ${name}`} className="space-y-1.5">
        {effects.components.map((component) => (
          <li className="text-xs" key={component.productId}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-foreground">{component.name}</span>
              <span className="shrink-0 font-medium tabular-nums text-foreground">
                +{component.quantityIn} un
              </span>
            </div>
            {component.productInactive ? (
              <p className="text-right text-on-surface-variant">Componente inactivo</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * «Ajustar reparto» de un surtido que se desarma: despliega el control de reparto
 * de Inventario con la receta × empaques de la línea. Con el reparto inválido el
 * control queda a la vista (su aviso es el motivo por el que no se puede recibir).
 */
function DistributionAdjust({
  disabled,
  effects,
  name,
  onChange,
  value,
}: {
  disabled: boolean;
  effects: ReceivePreviewDisassemble;
  name: string;
  onChange: (value: PackDistributionValue) => void;
  value: PackDistributionValue;
}) {
  const [requestedOpen, setRequestedOpen] = useState(false);
  const panelId = useId();
  const isInvalid = Boolean(effects.distributionError);
  const isOpen = requestedOpen || isInvalid;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          aria-controls={panelId}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Ocultar reparto" : "Ajustar reparto"} de ${name}`}
          disabled={disabled || isInvalid}
          onClick={() => setRequestedOpen(!isOpen)}
          size="sm"
          type="button"
          variant="outline"
        >
          {isOpen ? "Ocultar reparto" : "Ajustar reparto"}
        </Button>
        {effects.distribution ? (
          <p className="text-xs font-medium text-on-surface-variant">Reparto ajustado</p>
        ) : null}
      </div>
      <div id={panelId}>
        {isOpen ? (
          <PackDistributionFields
            components={effects.components.map((component) => ({
              isActive: !component.productInactive,
              name: component.name,
              unitProductId: component.productId,
              unitsPerPack: component.unitsPerPack,
            }))}
            disabled={disabled}
            legend={`Reparto de ${effects.packsOut} ${effects.packsOut === 1 ? "empaque" : "empaques"}`}
            onChange={onChange}
            packQuantity={effects.packsOut}
            value={value}
          />
        ) : null}
      </div>
    </div>
  );
}

function PreviewLine({
  disabled,
  distributionValue,
  line,
  onDisassembleChange,
  onDistributionChange,
}: {
  disabled: boolean;
  distributionValue?: PackDistributionValue;
  line: ReceivePreviewLine;
  onDisassembleChange?: (purchaseItemId: string, disassemble: boolean) => void;
  onDistributionChange?: (purchaseItemId: string, value: PackDistributionValue) => void;
}) {
  const itemId = line.purchaseItemId;

  return (
    <li className="space-y-2 py-3 text-sm">
      <p className="break-words font-medium text-foreground">{line.name}</p>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-on-surface-variant">Entra</dt>
        <dd className="text-right font-medium tabular-nums text-foreground">
          {quantityInLabel(line)}
          {line.packLabel ? (
            <span className="block text-xs font-normal text-on-surface-variant">
              Por {line.packLabel}
            </span>
          ) : null}
        </dd>

        <dt className="text-on-surface-variant">Costo unitario (sin impuesto)</dt>
        <dd className="text-right font-mono tabular-nums text-foreground">
          {formatRefUsd(line.unitCostRef)}
        </dd>
      </dl>

      {line.canDisassemble && itemId ? (
        onDisassembleChange ? (
          <PurchaseToggleSwitch
            checked={Boolean(line.disassemble)}
            disabled={disabled}
            label="Desarmar al recibir"
            onChange={(checked) => onDisassembleChange(itemId, checked)}
          />
        ) : line.disassemble ? (
          <p className="text-xs font-medium text-on-surface-variant">Se desarma al recibir</p>
        ) : null
      ) : null}

      {line.disassemble?.canAdjustDistribution && itemId && onDistributionChange ? (
        <DistributionAdjust
          disabled={disabled}
          effects={line.disassemble}
          name={line.name}
          onChange={(value) => onDistributionChange(itemId, value)}
          value={distributionValue ?? NO_DISTRIBUTION}
        />
      ) : null}

      {line.disassemble ? <DisassembleEffects effects={line.disassemble} name={line.name} /> : null}

      {line.disassembleUnavailable ? (
        <p className={noticeClassName}>
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Su receta de apertura ya no está activa: se recibirá sin desarmar
          </span>
        </p>
      ) : null}

      {line.productInactive ? (
        <p className={noticeClassName}>
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Producto inactivo: se recibirá igualmente</span>
        </p>
      ) : null}
    </li>
  );
}

/** Lo que la recepción le hace a un producto: stock neto y costo que queda fijado. */
type ProductEffect = {
  /** Costo (REF con IVA) antes → después; ausente si la recepción no fija su costo. */
  cost?: { after: number | null; before: number | null; inexact: string | null };
  isActive: boolean | null;
  name: string | null;
  productId: string;
  sku: string | null;
  stock?: PurchaseImpactStockLine;
};

/** Una fila por producto, en el orden del impact: su stock y, si lo hay, su costo. */
function buildProductEffects(impact: PurchaseImpact): ProductEffect[] {
  const rows = new Map<string, ProductEffect>();

  for (const line of impact.stock) {
    rows.set(line.productId, {
      isActive: line.isActive,
      name: line.productName,
      productId: line.productId,
      sku: line.sku,
      stock: line,
    });
  }

  for (const cost of impact.costs) {
    const row = rows.get(cost.productId) ?? {
      isActive: cost.isActive,
      name: cost.productName,
      productId: cost.productId,
      sku: cost.sku,
    };

    // Un producto comprado y además componente de un empaque: vale el primer
    // «antes» y el último «después» (la RPC recibe y luego desarma).
    row.cost = {
      after: cost.costRefAfter,
      before: row.cost ? row.cost.before : cost.costRefBefore,
      inexact: cost.inexact?.reason ?? row.cost?.inexact ?? null,
    };
    rows.set(cost.productId, row);
  }

  return [...rows.values()];
}

/** `true` si con el costo nuevo la ganancia del producto cae a una banda peor. */
function dropsMarginBand(
  row: ProductEffect,
  salePrice: number | undefined,
  thresholds: MarginThresholds | undefined,
) {
  if (salePrice === undefined || !row.cost || row.cost.before === null || row.cost.after === null) {
    return false;
  }

  return bandDrop(
    marginBand(markupPct(row.cost.before, salePrice), thresholds),
    marginBand(markupPct(row.cost.after, salePrice), thresholds),
  );
}

function formatCost(cost: number | null) {
  return cost === null ? "Sin costo" : formatRefUsd(cost);
}

function stockBreakdown(line: PurchaseImpactStockLine) {
  if (line.disassembledOut === 0 && line.componentsIn === 0) {
    return null;
  }

  const parts = [
    line.purchasedIn > 0 ? `entran ${line.purchasedIn} un por la compra` : null,
    line.disassembledOut > 0 ? `salen ${line.disassembledOut} un al desarmarse` : null,
    line.componentsIn > 0 ? `entran ${line.componentsIn} un de empaques desarmados` : null,
  ].filter((part): part is string => part !== null);
  const text = parts.join(" · ");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ProductEffectRow({
  dropsBand,
  row,
  salePrice,
  thresholds,
}: {
  dropsBand: boolean;
  row: ProductEffect;
  salePrice?: number;
  thresholds?: MarginThresholds;
}) {
  const { cost, stock } = row;
  const hasStock = stock && stock.stockBefore !== null && stock.stockAfter !== null;
  const breakdown = stock ? stockBreakdown(stock) : null;

  return (
    <li className="space-y-1.5 py-2 text-sm" data-band-drop={dropsBand || undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 break-words font-medium text-foreground">
          {row.name ?? "Producto que ya no existe"}
          {row.sku ? (
            <span className="ml-1.5 font-mono text-xs font-normal text-on-surface-variant">
              {row.sku}
            </span>
          ) : null}
        </span>
        {hasStock && stock.quantityDelta !== 0 ? (
          <span className="shrink-0 font-semibold tabular-nums text-foreground">
            {stock.quantityDelta < 0 ? "−" : "+"}
            {Math.abs(stock.quantityDelta)} un
          </span>
        ) : null}
      </div>

      {hasStock ? (
        <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          <span className="text-on-surface-variant">Stock</span>
          {stock.quantityDelta === 0 ? (
            <span className="tabular-nums text-on-surface-variant">
              {stock.stockBefore} un (no cambia)
            </span>
          ) : (
            <PurchaseImpactBeforeAfter
              after={`${stock.stockAfter} un`}
              before={`${stock.stockBefore} un`}
            />
          )}
        </p>
      ) : null}
      {breakdown ? <p className="text-xs text-on-surface-variant">{breakdown}</p> : null}

      {cost ? (
        <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          <span className="text-on-surface-variant">Costo que se fija (con IVA)</span>
          {cost.after === null ? (
            <span className="tabular-nums text-on-surface-variant">
              {formatCost(cost.before)} (no se puede anticipar)
            </span>
          ) : cost.after === cost.before ? (
            <span className="tabular-nums text-on-surface-variant">
              {formatCost(cost.after)} (no cambia)
            </span>
          ) : (
            <PurchaseImpactBeforeAfter
              after={formatCost(cost.after)}
              before={formatCost(cost.before)}
            />
          )}
        </p>
      ) : null}

      {dropsBand && cost && cost.before !== null && cost.after !== null && salePrice !== undefined ? (
        <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-amber-800 dark:text-amber-300">
            <TrendingDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Ganancia: baja de banda
          </span>
          <PurchaseImpactBeforeAfter
            after={<MarginBadge cost={cost.after} price={salePrice} thresholds={thresholds} />}
            before={<MarginBadge cost={cost.before} price={salePrice} thresholds={thresholds} />}
          />
        </p>
      ) : null}

      {row.isActive === false ? (
        <PurchaseImpactNotice>Producto inactivo: se recibe igual.</PurchaseImpactNotice>
      ) : null}
      {cost?.inexact ? <PurchaseImpactNotice>{cost.inexact}</PurchaseImpactNotice> : null}
      {stock?.inexact ? <PurchaseImpactNotice>{stock.inexact.reason}</PurchaseImpactNotice> : null}
    </li>
  );
}

/**
 * Lo que la recepción hará de verdad, por producto, según el impact: stock antes
 * → después (neto, con el desarme), costo que queda fijado y qué productos bajan
 * de banda de ganancia con ese costo. No calcula stock ni costos: los presenta.
 */
function ReceiveImpactEffects({
  impact,
  recalculating,
  salePrices,
  thresholds,
}: {
  impact: PurchaseImpact;
  recalculating: boolean;
  salePrices?: Readonly<Record<string, number>>;
  thresholds?: MarginThresholds;
}) {
  const rows = buildProductEffects(impact);
  const drops = new Set(
    rows
      .filter((row) => dropsMarginBand(row, salePrices?.[row.productId], thresholds))
      .map((row) => row.productId),
  );

  return (
    <div aria-busy={recalculating || undefined} className="space-y-2 py-2">
      {recalculating ? (
        <p
          className="flex items-center gap-2 text-xs font-medium text-on-surface-variant"
          role="status"
        >
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Recalculando el efecto con los cambios…
        </p>
      ) : null}

      <div className={cn("space-y-2", recalculating && "opacity-60")}>
        <p className="text-xs text-on-surface-variant">
          La compra pasa de <span className="font-medium text-foreground">Pedido</span> a{" "}
          <span className="font-medium text-foreground">Recibido</span>. El costo de cada producto
          queda en el de su línea con IVA (el último, no un promedio).
        </p>

        {impact.inexact ? <PurchaseImpactNotice>{impact.inexact.reason}</PurchaseImpactNotice> : null}

        {drops.size > 0 ? (
          <PurchaseImpactNotice>
            {drops.size === 1
              ? "1 producto baja de banda de ganancia con el costo nuevo."
              : `${drops.size} productos bajan de banda de ganancia con el costo nuevo.`}{" "}
            Al recibir, el aviso de reprecio de esta compra te deja ajustar sus precios.
          </PurchaseImpactNotice>
        ) : null}

        {rows.length > 0 ? (
          <ul aria-label="Stock y costo por producto" className="divide-y divide-border">
            {rows.map((row) => (
              <ProductEffectRow
                dropsBand={drops.has(row.productId)}
                key={row.productId}
                row={row}
                salePrice={salePrices?.[row.productId]}
                thresholds={thresholds}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-on-surface-variant">El inventario no cambia.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Confirmación de «Recibir mercancía» (COM-07 + CNF-04). Arriba, lo que se va a
 * enviar, línea a línea: lo que entra, «Desarmar al recibir» en los empaques con
 * receta (COM-14) y, en un surtido, «Ajustar reparto». Debajo, «Qué va a pasar»:
 * el efecto real que devolvió el impact para ESA lista (stock antes → después por
 * producto, costo que se fija y productos que bajan de banda de ganancia).
 *
 * Un solo diálogo: sin efecto permitido a la vista (cargando, error, rechazo de
 * la RPC o recalculando tras un cambio) no se puede recibir. Las líneas siguen
 * editables en todos los estados, para poder corregir lo que impide recibir.
 * Las dos listas hacen scroll por dentro, sin desbordar en pantallas estrechas.
 */
export function PurchaseReceivePreviewModal({
  distributionValues,
  effect,
  error,
  isPending = false,
  lines,
  onConfirm,
  onDisassembleChange,
  onDistributionChange,
  onOpenChange,
  open,
  purchaseNumber,
  salePrices,
  thresholds,
}: PurchaseReceivePreviewModalProps) {
  const disassembles = lines.some((line) => line.disassemble);
  const distributionInvalid = lines.some((line) => line.disassemble?.distributionError);
  const { impact } = effect;
  const recalculating = Boolean(effect.recalculating);
  const blockingProducts = impact && !impact.allowed ? impact.blockingProducts : [];

  return (
    <ConfirmActionModal
      confirmLabel="Recibir mercancía"
      description={
        effect.status === "blocked"
          ? "La mercancía no se puede recibir así. No se ha cambiado nada."
          : disassembles
            ? "La mercancía entrará al inventario, los empaques marcados se abrirán en sus componentes y la compra pasará a recibida."
            : "La mercancía entrará al inventario y la compra pasará a recibida."
      }
      error={error}
      // Recalculando no hay efecto vigente que confirmar: el botón espera.
      isPending={isPending || recalculating}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      onRetry={effect.onRetry}
      open={open}
      renderEffects={
        impact
          ? () =>
              distributionInvalid ? (
                <div className="py-2">
                  <PurchaseImpactNotice>
                    El reparto de un surtido no cuadra: corrígelo para ver el stock y el costo
                    que quedarán.
                  </PurchaseImpactNotice>
                </div>
              ) : (
                <ReceiveImpactEffects
                  impact={impact}
                  recalculating={recalculating}
                  salePrices={salePrices}
                  thresholds={thresholds}
                />
              )
          : undefined
      }
      status={effect.status}
      statusHint={
        effect.status === "error"
          ? "Sin el efecto a la vista no se puede recibir. No se ha cambiado nada."
          : undefined
      }
      statusMessage={
        effect.status === "loading"
          ? "Calculando el stock y el costo que quedarán…"
          : effect.status === "blocked"
            ? impact?.reason
            : effect.message
      }
      title="Recibir mercancía"
    >
      <div className="flex flex-col gap-3">
        <p>Compra {purchaseNumber}</p>

        {lines.length === 0 ? (
          <p>Esta compra no tiene productos registrados.</p>
        ) : (
          <section className="overflow-hidden rounded-md border border-border">
            <h3 className={cn(sectionTitleClassName, "border-b border-border px-3 py-2")}>
              Mercancía que entra
            </h3>
            <ul
              aria-label="Mercancía que entra"
              className="max-h-64 divide-y divide-border overflow-y-auto px-3"
            >
              {lines.map((line, index) => (
                <PreviewLine
                  disabled={isPending}
                  distributionValue={
                    line.purchaseItemId ? distributionValues?.[line.purchaseItemId] : undefined
                  }
                  key={line.purchaseItemId ?? `${line.productId}-${index}`}
                  line={line}
                  onDisassembleChange={onDisassembleChange}
                  onDistributionChange={onDistributionChange}
                />
              ))}
            </ul>
          </section>
        )}

        {blockingProducts.length > 0 ? (
          <PurchaseImpactBlockingProducts products={blockingProducts} />
        ) : null}
      </div>
    </ConfirmActionModal>
  );
}
