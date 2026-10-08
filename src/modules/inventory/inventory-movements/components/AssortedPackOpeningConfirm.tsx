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
 * Confirmación de la apertura de un surtido con el efecto del reparto. Se
 * monta dentro del modal del formulario; mientras el envío está en vuelo no se
 * cierra, y un error del servidor se muestra tal cual para reintentar.
 */
export function AssortedPackOpeningConfirm({ opening }: AssortedPackOpeningConfirmProps) {
  const { effect } = opening;

  if (!effect) {
    return null;
  }

  return (
    <ConfirmActionModal
      confirmLabel="Abrir empaque"
      description={`Vas a abrir ${effect.packQuantity} empaque(s) de ${effect.pack.name} con este reparto.`}
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
      title="Abrir empaque surtido"
    />
  );
}
