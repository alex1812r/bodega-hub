"use client";

import { Button } from "@/shared/components/Button";

import type { AssortedPackOpening } from "../hooks/useAssortedPackOpening";

import { PackDistributionFields } from "./PackDistributionFields";

type AssortedPackOpeningFieldsProps = {
  opening: AssortedPackOpening;
};

/** Sin tocar el reparto, el control parte de la receta. */
const RECIPE_DISTRIBUTION: Record<string, string> = {};

/**
 * Reparto editable de la apertura de un surtido. Pinta el control ÚNICO de
 * reparto, `PackDistributionFields` (el mismo de «Desarmar al recibir» de una
 * compra, COM-14), con el estado de `useAssortedPackOpening`. No pinta nada
 * mientras no haya un surtido elegido y una cantidad de empaques válida.
 */
export function AssortedPackOpeningFields({ opening }: AssortedPackOpeningFieldsProps) {
  if (!opening.effect || !opening.showsDistribution) {
    return null;
  }

  return (
    <PackDistributionFields
      components={opening.components}
      onChange={(value) => {
        if (Object.keys(value).length === 0) {
          opening.resetDistribution();
          return;
        }

        opening.setValues(value);
      }}
      packQuantity={opening.packQuantity}
      value={opening.isEdited ? opening.values : RECIPE_DISTRIBUTION}
    />
  );
}

type AssortedPackOpeningActionsProps = {
  formId: string;
  onCancel: () => void;
  opening: AssortedPackOpening;
};

/** Pie del formulario de un surtido: "Continuar" lleva a la confirmación y se apaga si el reparto no cuadra. */
export function AssortedPackOpeningActions({
  formId,
  onCancel,
  opening,
}: AssortedPackOpeningActionsProps) {
  return (
    <>
      <Button onClick={onCancel} type="button" variant="outline">
        Cancelar
      </Button>
      <Button disabled={opening.hasDistributionIssue} form={formId} type="submit">
        Continuar
      </Button>
    </>
  );
}
