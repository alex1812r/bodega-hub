"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";

import { PackDistributionFields } from "@/modules/inventory/inventory-movements/components/PackDistributionFields";
import type { PackDistributionValue } from "@/modules/inventory/inventory-movements/utils/packDistribution";
import { Button } from "@/shared/components/Button";

import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { formatRefUsd } from "@/shared/utils/currency";

import { PurchaseToggleSwitch } from "../../purchase-create/components/PurchaseToggleSwitch";
import type { ReceivePreviewDisassemble, ReceivePreviewLine } from "../utils/buildReceivePreview";

type PurchaseReceivePreviewModalProps = {
  /** Lo tecleado en «Ajustar reparto», por línea; sin entrada, la receta. */
  distributionValues?: Readonly<Record<string, PackDistributionValue>>;
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
};

const NO_DISTRIBUTION: PackDistributionValue = {};

const noticeClassName =
  "flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300";

function quantityInLabel(line: ReceivePreviewLine) {
  if (line.packCount && line.unitsPerPack) {
    return `${line.packCount} × ${line.unitsPerPack} = ${line.quantityIn} un`;
  }

  return `${line.quantityIn} un`;
}

function StockChange({ after, before }: { after: number; before: number }) {
  return (
    <>
      <span className="text-on-surface-variant">{before} un</span>
      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="sr-only">pasa a</span>
      <span className="font-semibold">{after} un</span>
    </>
  );
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
            <div className="flex flex-wrap items-center justify-end gap-1.5 tabular-nums text-foreground">
              <StockChange after={component.stockAfter} before={component.stockBefore} />
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

        <dt className="text-on-surface-variant">Stock</dt>
        <dd className="flex flex-wrap items-center justify-end gap-1.5 tabular-nums text-foreground">
          {line.stockBefore === null || line.stockAfter === null ? (
            <span className="text-on-surface-variant">Sin dato de stock</span>
          ) : (
            <StockChange after={line.stockAfter} before={line.stockBefore} />
          )}
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

/**
 * Previsualización de cantidades al recibir un pedido (COM-07): por línea, lo que
 * entra, el stock antes → después y el costo unitario. En la línea de un empaque
 * con receta (COM-14) deja marcar o desmarcar «Desarmar al recibir» y, marcada,
 * muestra el segundo efecto: los empaques que salen y lo que sube cada componente.
 * Si el empaque es un surtido, «Ajustar reparto» deja repartir las unidades entre
 * sus componentes; los efectos se actualizan con lo tecleado.
 * La lista apila los datos de cada línea y hace scroll dentro del modal, sin
 * desbordar en pantallas estrechas.
 */
export function PurchaseReceivePreviewModal({
  error,
  isPending = false,
  distributionValues,
  lines,
  onConfirm,
  onDisassembleChange,
  onDistributionChange,
  onOpenChange,
  open,
  purchaseNumber,
}: PurchaseReceivePreviewModalProps) {
  const disassembles = lines.some((line) => line.disassemble);

  return (
    <ConfirmActionModal
      confirmLabel="Recibir mercancía"
      description={
        disassembles
          ? "La mercancía entrará al inventario, los empaques marcados se abrirán en sus componentes y la compra pasará a recibida."
          : "La mercancía entrará al inventario y la compra pasará a recibida."
      }
      error={error}
      isPending={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={open}
      renderEffects={() =>
        lines.length === 0 ? (
          <p className="py-3 text-sm text-on-surface-variant">
            Esta compra no tiene productos registrados.
          </p>
        ) : (
          <ul aria-label="Mercancía que entra" className="divide-y divide-border">
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
        )
      }
      title="Recibir mercancía"
    >
      Compra {purchaseNumber}
    </ConfirmActionModal>
  );
}
