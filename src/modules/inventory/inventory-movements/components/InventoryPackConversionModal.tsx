"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import { Button } from "@/shared/components/Button";
import { EntityAutocomplete, type EntityFetcher } from "@/shared/components/EntityAutocomplete";
import { ErrorState } from "@/shared/components/ErrorState";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { ProcessGuardModal } from "@/shared/components/ProcessGuard";
import { Textarea } from "@/shared/components/Textarea";
import { useToast } from "@/shared/components/Toast";
import { useFormModalDiscardGuard } from "@/shared/hooks/useFormModalDiscardGuard";

import { packConversionsQueryOptions, usePackConversions } from "../../hooks/useInventory";
import { STOCK_REASON_MAX_LENGTH, describeStockReasonLength } from "../../utils/stockReason";
import {
  type AssortedPackOpeningTarget,
  useAssortedPackOpening,
} from "../hooks/useAssortedPackOpening";
import { AssortedPackOpeningConfirm } from "./AssortedPackOpeningConfirm";
import { AssortedPackOpeningActions, AssortedPackOpeningFields } from "./AssortedPackOpeningFields";
import {
  buildPackOpeningToast,
  describeRecipeOpening,
  isAssortedOpening,
} from "./packOpeningText";
import { describePackRecipe, searchPackOptions } from "./packProductOptions";

const formId = "inventory-pack-conversion-form";

const DEFAULT_PACK_QUANTITY = "1";

type InventoryPackConversionModalProps = {
  /**
   * Empaque precargado; el usuario puede cambiarlo. Si el producto no es un
   * empaque con receta activa el campo queda vacío.
   */
  defaultPackProductId?: string;
  trigger?: ReactNode;
};

/**
 * Conversión de empaques en unidades: el formulario no envía, abre la
 * confirmación con el efecto de la conversión.
 *
 * Si el usuario cambió algo respecto a como abrió el modal (otro empaque,
 * cantidad, reparto del surtido o motivo), cerrar (Esc, clic fuera, Cancelar,
 * la X) o salir de la pantalla pregunta antes con el guardia de proceso; sin
 * cambios, o tras convertir, cierra sin preguntar. El empaque precargado y la
 * cantidad inicial no cuentan.
 */
export function InventoryPackConversionModal({
  defaultPackProductId,
  trigger,
}: InventoryPackConversionModalProps = {}) {
  const [open, setOpen] = useState(false);
  const [packProductId, setPackProductId] = useState("");
  const [packQuantity, setPackQuantity] = useState(DEFAULT_PACK_QUANTITY);
  const [reason, setReason] = useState("");
  // Se activa al tocar la cantidad o al intentar enviar; al abrir no hay aviso.
  const [showQuantityError, setShowQuantityError] = useState(false);
  // Se activa al intentar enviar sin empaque elegido.
  const [showPackError, setShowPackError] = useState(false);
  const queryClient = useQueryClient();
  const packConversionsQuery = usePackConversions();
  const { showToast } = useToast();

  const recipesByPackId = useMemo(
    () => new Map((packConversionsQuery.data ?? []).map((item) => [item.packProduct.id, item])),
    [packConversionsQuery.data],
  );
  const selected = recipesByPackId.get(packProductId);
  // Las recetas son la fuente (ver packProductOptions): se buscan en la consulta ya cargada.
  const fetchPackOptions: EntityFetcher<"product"> = async ({ limit, query }) =>
    searchPackOptions(await queryClient.ensureQueryData(packConversionsQueryOptions), query, limit);
  const isLoadingDefaultPack = Boolean(packProductId) && packConversionsQuery.isLoading;
  // Sin recetas no hay empaque que elegir: se dice el error y se ofrece reintentar. Si
  // falla un refresco con recetas ya cargadas, el formulario sigue (el servidor valida).
  const recipesError =
    packConversionsQuery.isError && packConversionsQuery.data === undefined
      ? packConversionsQuery.error
      : null;

  const quantityNumber = Number(packQuantity);
  const unitPreview =
    selected && quantityNumber > 0 ? quantityNumber * selected.unitsPerPack : 0;
  const canSubmit =
    Boolean(selected) &&
    quantityNumber > 0 &&
    // Con decimales el propio campo avisa ("Debe ser un número entero."): aquí solo se bloquea el envío.
    Number.isInteger(quantityNumber) &&
    quantityNumber <= (selected?.packProduct.currentStock ?? 0);
  const packStock = selected?.packProduct.currentStock;
  const isAssorted = selected ? isAssortedOpening(selected) : false;
  // Lo que se abre: el reparto del surtido o, en un 1 a 1, su único producto unidad.
  const target: AssortedPackOpeningTarget | null = !selected
    ? null
    : isAssorted
      ? { components: selected.components ?? [], pack: selected.packProduct }
      : {
          components: [
            {
              currentStock: selected.linkedProduct.currentStock,
              // Un servidor anterior al surtido no dice si la unidad está activa.
              isActive:
                selected.components?.find(
                  (component) => component.unitProductId === selected.linkedProduct.id,
                )?.isActive ?? true,
              name: selected.linkedProduct.name,
              sku: selected.linkedProduct.sku,
              unitProductId: selected.linkedProduct.id,
              unitsPerPack: selected.unitsPerPack,
            },
          ],
          kind: "single",
          pack: selected.packProduct,
        };
  // Surtido y 1 a 1 confirman con su efecto antes de enviar (CNF-08); solo el surtido edita el reparto.
  const assorted = useAssortedPackOpening({
    onOpened: (result, effect) => {
      if (selected) {
        showToast(
          buildPackOpeningToast({
            packName: effect.pack.name,
            packQuantity: effect.packQuantity,
            recipe: selected,
            result,
          }),
        );
      }
      resetForm();
      setOpen(false);
    },
    isOpen: open,
    packQuantity: quantityNumber,
    reason,
    target,
  });
  const hasTypedData =
    packProductId !== (defaultPackProductId ?? "") ||
    packQuantity !== DEFAULT_PACK_QUANTITY ||
    reason.trim() !== "" ||
    assorted.isEdited;
  // Con la conversión en vuelo no se pregunta: el cierre ya está bloqueado.
  const { guard, requestClose, trackFocus } = useFormModalDiscardGuard({
    active: open && hasTypedData && !assorted.isPending,
    label: selected
      ? `Conversión de «${selected.packProduct.name}» sin registrar`
      : "Conversión de empaque sin registrar",
  });
  // Sin `min`/`max` en el input no hay burbuja nativa: el motivo se dice aquí.
  const quantityError = !showQuantityError
    ? undefined
    : !(quantityNumber > 0)
      ? "Indica una cantidad mayor a cero."
      : packStock === undefined || quantityNumber <= packStock
        ? undefined
        : packStock <= 0
          ? "No hay empaques en stock para abrir."
          : `Solo hay ${packStock} empaque(s) en stock.`;

  function resetForm() {
    setPackProductId(defaultPackProductId ?? "");
    setPackQuantity(DEFAULT_PACK_QUANTITY);
    setReason("");
    setShowQuantityError(false);
    setShowPackError(false);
    assorted.reset();
  }

  /** El formulario no envía: abre la confirmación con el efecto de la conversión. */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Sin empaque, sin cantidad válida o con más empaques de los que hay no se llega a confirmar.
    if (!canSubmit) {
      setShowPackError(true);
      setShowQuantityError(true);
      return;
    }

    if (assorted.isPending) {
      return;
    }

    assorted.openConfirm();
  }

  return (
    <Modal
      contentClassName="sm:max-w-lg"
      description="Convierte empaques cerrados en unidades sueltas con movimiento de inventario emparejado."
      footer={({ close }) =>
        recipesError ? (
          <Button onClick={close} type="button" variant="outline">
            Cerrar
          </Button>
        ) : (
          <AssortedPackOpeningActions formId={formId} onCancel={close} opening={assorted} />
        )
      }
      onOpenChange={(nextOpen) => {
        // Con una conversión en vuelo (1 a 1 o surtido) el modal no se cierra.
        if (!nextOpen && assorted.isPending) {
          return;
        }

        if (nextOpen) {
          setOpen(true);
          setPackProductId(defaultPackProductId ?? "");
          // El stock del empaque y de sus componentes se lee al abrir: el efecto no se calcula con caché.
          void packConversionsQuery.refetch();
          return;
        }

        // Con cambios pregunta antes de descartarlos.
        requestClose(() => {
          setOpen(false);
          // Cerrar descarta el intento (`assorted.reset`): al reabrir, clave nueva y sin el error anterior.
          resetForm();
        });
      }}
      open={open}
      title="Convertir empaque"
      trigger={
        trigger ?? (
          <Button size="sm" type="button" variant="outline">
            Convertir empaque
          </Button>
        )
      }
    >
      {recipesError ? (
        <div role="alert">
          <ErrorState
            description={recipesError.message}
            onRetry={() => void packConversionsQuery.refetch()}
            title="No pudimos cargar los empaques"
          />
        </div>
      ) : (
        <form className="grid gap-4" id={formId} onFocus={trackFocus} onSubmit={handleSubmit}>
          <EntityAutocomplete
            disabled={isLoadingDefaultPack || assorted.isPending}
            entity="product"
            error={showPackError && !selected ? "Selecciona un empaque." : undefined}
            fetcher={fetchPackOptions}
            helperText={
              isLoadingDefaultPack
                ? "Cargando empaque…"
                : packConversionsQuery.isLoading
                  ? "Cargando empaques…"
                  : packConversionsQuery.error
                    ? packConversionsQuery.error.message
                    : "Solo empaques con receta activa."
            }
            label="Producto empaque"
            onChange={(option) => setPackProductId(option?.id ?? "")}
            placeholder="Buscar empaque por nombre o SKU"
            // Sin recientes: un empaque guardado en el navegador puede haber perdido su receta.
            recentsKey={null}
            renderSecondary={(option) => {
              const recipe = recipesByPackId.get(option.id);

              return [option.sku, `Stock ${option.currentStock}`, recipe ? describePackRecipe(recipe) : ""]
                .filter(Boolean)
                .join(" · ");
            }}
            value={selected ? { id: selected.packProduct.id, label: selected.packProduct.name } : null}
          />
          {selected ? (
            <p className="text-sm text-on-surface-variant">
              Stock empaque: {selected.packProduct.currentStock}.{" "}
              {isAssorted
                ? `Por empaque: ${describeRecipeOpening(selected, 1)}.`
                : `Unidad: ${selected.linkedProduct.name} (stock ${selected.linkedProduct.currentStock}).`}
            </p>
          ) : null}
          <NumberInput
            decimals={0}
            disabled={assorted.isPending}
            error={quantityError}
            label="Cantidad de empaques"
            onChange={(event) => {
              setPackQuantity(event.target.value);
              setShowQuantityError(true);
            }}
            required
            value={packQuantity}
          />
          <p className="text-sm text-on-surface-variant">
            Vista previa: −{quantityNumber || 0} empaque(s) / +{unitPreview} unidad(es).
          </p>
          <AssortedPackOpeningFields opening={assorted} />
          <Textarea
            disabled={assorted.isPending}
            error={assorted.reasonError}
            helperText={describeStockReasonLength(reason)}
            label="Motivo"
            maxLength={STOCK_REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
          {/* Con la confirmación abierta el error se dice en ella; al cancelarla sigue a la vista aquí. */}
          {assorted.error && !assorted.confirmOpen ? (
            <p
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
              role="alert"
            >
              {assorted.error}
            </p>
          ) : null}
        </form>
      )}
      {/* La pregunta del guardia (ATRÁS del navegador) no se apila sobre la confirmación. */}
      <AssortedPackOpeningConfirm
        opening={{ ...assorted, confirmOpen: assorted.confirmOpen && !guard.dialog.open }}
      />
      <ProcessGuardModal guard={guard} />
    </Modal>
  );
}
