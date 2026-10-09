"use client";

import { type ConfirmActionEffect, ConfirmActionModal } from "@/shared/components/ConfirmActionModal";

import type { AssortedPackOpening } from "../hooks/useAssortedPackOpening";
import type { PackOpeningEffect } from "../utils/packOpeningEffect";

/** "−3 Surtido A" y "+a {nombre}" por componente con unidades, cada uno con su stock antes → después. */
export function buildPackOpeningConfirmEffects(effect: PackOpeningEffect): ConfirmActionEffect[] {
  return [
    {
      after: String(effect.pack.stockAfter),
      before: `Stock ${effect.pack.stockBefore}`,
      label: `−${effect.packQuantity} ${effect.pack.name}`,
      tone: "neutral",
    },
    ...effect.components
      .filter((component) => component.units > 0)
      .map(
        (component): ConfirmActionEffect => ({
          after: String(component.stockAfter),
          before: `Stock ${component.stockBefore}`,
          label: `+${component.units} ${component.name}${component.isActive ? "" : " (inactivo)"}`,
          tone: component.isActive ? "positive" : "warning",
        }),
      ),
  ];
}

type AssortedPackOpeningConfirmProps = {
  opening: AssortedPackOpening;
};

/**
 * Confirmación de la apertura de un empaque con su efecto: las dos caras de un
 * 1 a 1 (−N empaques, +N × u unidades) o el reparto de un surtido, y el motivo
 * tecleado. Se monta dentro del modal del formulario; mientras el envío está en
 * vuelo no se cierra, y un error del servidor se muestra tal cual para
 * reintentar sin perder el formulario de debajo.
 */
export function AssortedPackOpeningConfirm({ opening }: AssortedPackOpeningConfirmProps) {
  const { effect } = opening;

  if (!effect) {
    return null;
  }

  return (
    <ConfirmActionModal
      confirmLabel={opening.isSingle ? "Convertir empaque" : "Abrir empaque"}
      description={
        opening.isSingle
          ? `Vas a convertir ${effect.packQuantity} empaque(s) de ${effect.pack.name} en ${effect.distributedTotal} unidad(es) sueltas.`
          : `Vas a abrir ${effect.packQuantity} empaque(s) de ${effect.pack.name} con este reparto.`
      }
      effects={buildPackOpeningConfirmEffects(effect)}
      error={opening.error}
      isPending={opening.isPending}
      onConfirm={opening.confirm}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          opening.closeConfirm();
        }
      }}
      open={opening.confirmOpen}
      title={opening.isSingle ? "Confirmar conversión de empaque" : "Abrir empaque surtido"}
    >
      {/* Sin motivo no se llega aquí: `openConfirm` lo exige. */}
      <p className="whitespace-pre-wrap break-words">
        Motivo: <span className="font-medium text-foreground">{opening.reason}</span>
      </p>
    </ConfirmActionModal>
  );
}
