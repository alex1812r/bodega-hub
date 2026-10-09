"use client";

import { useState } from "react";

import { parseNumberInput } from "@/shared/components/NumberInput";

import { type ConvertPackToUnitsResult, useConvertPackToUnits } from "../../hooks/useInventory";
import { useReleaseAttemptOnClose, useRequestAttempt } from "../../utils/requestAttempt";
import { describeStockRequestError } from "../../utils/stockRequestError";
import {
  buildDefaultPackOpeningDistribution,
  computePackOpeningEffect,
  type PackOpeningEffect,
  type PackOpeningRecipeComponent,
  toPackOpeningRequestComponents,
} from "../utils/packOpeningEffect";

export type AssortedPackOpeningTarget = {
  /**
   * Componentes de la receta (`packConversion.components`). En un 1 a 1, su
   * único producto unidad.
   */
  components: PackOpeningRecipeComponent[];
  /**
   * `assorted` (por defecto): reparto editable, que viaja en `components`.
   * `single`: empaque 1 a 1; sin reparto que editar y la petición no lleva
   * `components` (el cuerpo de siempre). Los dos confirman con su efecto.
   */
  kind?: "assorted" | "single";
  pack: { currentStock: number; id: string; name: string };
};

type EditedDistribution = {
  packId: string;
  /** Texto de cada campo, por id de producto componente. */
  values: Record<string, string>;
};

type UseAssortedPackOpeningInput = {
  /** El modal anfitrión está abierto: al cerrarse se reabre el intento (ver `lockAfterSuccess`). */
  isOpen: boolean;
  /** Tras la respuesta 201: el anfitrión avisa, cierra su modal y limpia su formulario. */
  onOpened: (result: ConvertPackToUnitsResult, effect: PackOpeningEffect) => void;
  /** Cantidad de empaques tal como la interpreta el anfitrión (0 si el campo está vacío). */
  packQuantity: number;
  reason: string;
  /** `null` si no hay empaque que abrir: el hook no hace nada. */
  target: AssortedPackOpeningTarget | null;
};

/**
 * Apertura de un empaque con confirmación: efecto calculado (lo que sale del
 * empaque y lo que entra a cada producto, con su stock antes → después),
 * confirmación y envío. En un surtido lleva además el reparto editable, que
 * viaja en `components`; en un 1 a 1 (`kind: "single"`, CNF-08) no hay reparto
 * y el cuerpo no cambia. Lo comparten el modal de Inventario y el del detalle
 * del producto, junto con `AssortedPackOpeningFields` y
 * `AssortedPackOpeningConfirm`.
 *
 * Mientras el usuario no toca el reparto, sigue a la receta × empaques. Al
 * editar un campo se conserva lo tecleado en todos aunque cambie la cantidad de
 * empaques: el aviso de suma dice cuánto falta o sobra y "Restablecer receta"
 * vuelve a la receta.
 */
export function useAssortedPackOpening({
  isOpen,
  onOpened,
  packQuantity,
  reason,
  target,
}: UseAssortedPackOpeningInput) {
  const [edited, setEdited] = useState<EditedDistribution | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Otro reparto estrena clave: "misma clave + otro reparto" es un 409 en el servidor.
  // Tras abrirse el surtido no sale otra apertura hasta que el modal anfitrión se cierre.
  const attempt = useRequestAttempt({ lockAfterSuccess: true, renewOnContentChange: true });
  useReleaseAttemptOnClose(attempt, isOpen);
  const convert = useConvertPackToUnits();

  const isSingle = target?.kind === "single";
  // Un reparto tecleado para otro empaque no vale para este; un 1 a 1 no tiene reparto que teclear.
  const editedValues =
    target && !isSingle && edited?.packId === target.pack.id ? edited.values : null;
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
  const showsDistribution =
    Boolean(effect) && !isSingle && !effect?.issues.includes("invalid_quantity");
  const hasDistributionIssue =
    showsDistribution &&
    Boolean(effect?.issues.some((issue) => issue === "sum_mismatch" || issue === "invalid_units"));

  function setUnits(unitProductId: string, text: string) {
    if (!target) {
      return;
    }

    setEdited({ packId: target.pack.id, values: { ...values, [unitProductId]: text } });
  }

  /** Texto de todos los campos a la vez (lo que emite `PackDistributionFields`). */
  function setValues(next: Record<string, string>) {
    if (!target) {
      return;
    }

    setEdited({ packId: target.pack.id, values: next });
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
      // El 1 a 1 no envía reparto: el servidor aplica la receta.
      ...(isSingle ? {} : { components: toPackOpeningRequestComponents(effect) }),
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
    /** Componentes de la receta del surtido elegido (`[]` sin surtido). */
    components: target?.components ?? [],
    confirm,
    confirmOpen,
    effect,
    /** `error.message` del servidor tal cual, o el aviso de resultado incierto. */
    error: convert.error ? describeStockRequestError(convert.error) : null,
    /** El reparto no suma o tiene unidades no enteras: no se puede continuar. */
    hasDistributionIssue,
    isEdited: editedValues !== null,
    isPending: convert.isPending,
    /** Empaque 1 a 1: la confirmación lo dice con sus textos. */
    isSingle,
    openConfirm,
    packQuantity,
    /** Motivo tecleado, sin los espacios de los extremos ("" si no hay): la confirmación lo muestra. */
    reason: reason.trim(),
    /** Limpia reparto, confirmación y error, y descarta el intento (al cerrar el modal anfitrión). */
    reset,
    resetDistribution: () => setEdited(null),
    setUnits,
    setValues,
    showsDistribution,
    values,
  };
}

export type AssortedPackOpening = ReturnType<typeof useAssortedPackOpening>;
