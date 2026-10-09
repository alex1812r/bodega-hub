"use client";

import { useState } from "react";

import { parseNumberInput } from "@/shared/components/NumberInput";

import { type ConvertPackToUnitsResult, useConvertPackToUnits } from "../../hooks/useInventory";
import { useRequestAttempt } from "../../utils/requestAttempt";
import { describeStockRequestError } from "../../utils/stockRequestError";
import {
  buildDefaultPackOpeningDistribution,
  computePackOpeningEffect,
  type PackOpeningEffect,
  type PackOpeningRecipeComponent,
  toPackOpeningRequestComponents,
} from "../utils/packOpeningEffect";

export type AssortedPackOpeningTarget = {
  /** Componentes de la receta (`packConversion.components`). */
  components: PackOpeningRecipeComponent[];
  pack: { currentStock: number; id: string; name: string };
};

type EditedDistribution = {
  packId: string;
  /** Texto de cada campo, por id de producto componente. */
  values: Record<string, string>;
};

type UseAssortedPackOpeningInput = {
  /** Tras la respuesta 201: el anfitrión avisa, cierra su modal y limpia su formulario. */
  onOpened: (result: ConvertPackToUnitsResult, effect: PackOpeningEffect) => void;
  /** Cantidad de empaques tal como la interpreta el anfitrión (0 si el campo está vacío). */
  packQuantity: number;
  reason: string;
  /** `null` si el empaque elegido no es un surtido: el hook no hace nada. */
  target: AssortedPackOpeningTarget | null;
};

/**
 * Apertura de un empaque surtido con reparto editable: estado de la
 * distribución, efecto calculado, confirmación y envío con `components`. Lo
 * comparten el modal de Inventario y el del detalle del producto, junto con
 * `AssortedPackOpeningFields` y `AssortedPackOpeningConfirm`.
 *
 * Mientras el usuario no toca el reparto, sigue a la receta × empaques. Al
 * editar un campo se conserva lo tecleado en todos aunque cambie la cantidad de
 * empaques: el aviso de suma dice cuánto falta o sobra y "Restablecer receta"
 * vuelve a la receta.
 */
export function useAssortedPackOpening({
  onOpened,
  packQuantity,
  reason,
  target,
}: UseAssortedPackOpeningInput) {
  const [edited, setEdited] = useState<EditedDistribution | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Otro reparto estrena clave: "misma clave + otro reparto" es un 409 en el servidor.
  const attempt = useRequestAttempt({ renewOnContentChange: true });
  const convert = useConvertPackToUnits();

  // Un reparto tecleado para otro empaque no vale para este.
  const editedValues = target && edited?.packId === target.pack.id ? edited.values : null;
  const defaults = target ? buildDefaultPackOpeningDistribution(target.components, packQuantity) : {};
  const values: Record<string, string> = Object.fromEntries(
    (target?.components ?? []).map((component) => [
      component.unitProductId,
      editedValues?.[component.unitProductId] ?? String(defaults[component.unitProductId] ?? 0),
    ]),
  );
  const effect = target
    ? computePackOpeningEffect({
        distribution: Object.fromEntries(
          // Un campo vacío reparte 0 unidades.
          Object.entries(values).map(([id, text]) => [id, parseNumberInput(text) ?? 0]),
        ),
        packQuantity,
        recipe: target,
      })
    : null;
  // Sin una cantidad de empaques válida no hay total contra el que repartir.
  const showsDistribution = Boolean(effect) && !effect?.issues.includes("invalid_quantity");
  const hasDistributionIssue =
    showsDistribution &&
    Boolean(effect?.issues.some((issue) => issue === "sum_mismatch" || issue === "invalid_units"));

  function setUnits(unitProductId: string, text: string) {
    if (!target) {
      return;
    }

    setEdited({ packId: target.pack.id, values: { ...values, [unitProductId]: text } });
  }

  function reset() {
    setEdited(null);
    setConfirmOpen(false);
    convert.reset();
    attempt.discard();
  }

  /** Abre la confirmación si el reparto se puede enviar. */
  function openConfirm() {
    if (!effect?.isValid) {
      return false;
    }

    // Un error de un intento anterior no pertenece a esta confirmación.
    convert.reset();
    setConfirmOpen(true);

    return true;
  }

  async function confirm() {
    if (!target || !effect?.isValid) {
      return;
    }

    const input = {
      components: toPackOpeningRequestComponents(effect),
      packProductId: target.pack.id,
      packQuantity,
      reason: reason.trim() || undefined,
    };
    // null = ya hay un envío en vuelo (doble clic).
    const clientRequestId = attempt.begin(input);

    if (!clientRequestId) {
      return;
    }

    try {
      const result = await convert.mutateAsync({ ...input, clientRequestId });
      attempt.succeed();
      setConfirmOpen(false);
      setEdited(null);
      onOpened(result, effect);
    } catch (error) {
      // El mensaje llega por `error`; la confirmación sigue abierta para reintentar.
      attempt.fail(error);
    }
  }

  return {
    closeConfirm: () => setConfirmOpen(false),
    confirm,
    confirmOpen,
    effect,
    /** `error.message` del servidor tal cual, o el aviso de resultado incierto. */
    error: convert.error ? describeStockRequestError(convert.error) : null,
    /** El reparto no suma o tiene unidades no enteras: no se puede continuar. */
    hasDistributionIssue,
    isEdited: editedValues !== null,
    isPending: convert.isPending,
    openConfirm,
    /** Limpia reparto, confirmación y error, y descarta el intento (al cerrar el modal anfitrión). */
    reset,
    resetDistribution: () => setEdited(null),
    setUnits,
    showsDistribution,
    values,
  };
}

export type AssortedPackOpening = ReturnType<typeof useAssortedPackOpening>;
