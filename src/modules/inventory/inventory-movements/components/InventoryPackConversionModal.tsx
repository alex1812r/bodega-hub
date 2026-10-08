"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import { Button } from "@/shared/components/Button";
import { EntityAutocomplete, type EntityFetcher } from "@/shared/components/EntityAutocomplete";
import { FormActions } from "@/shared/components/FormActions";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { Textarea } from "@/shared/components/Textarea";
import { useToast } from "@/shared/components/Toast";

import {
  packConversionsQueryOptions,
  useConvertPackToUnits,
  usePackConversions,
} from "../../hooks/useInventory";
import { useRequestAttempt } from "../../utils/requestAttempt";
import {
  buildPackOpeningToast,
  describeRecipeOpening,
  isAssortedOpening,
} from "./packOpeningText";
import { describePackRecipe, searchPackOptions } from "./packProductOptions";

const formId = "inventory-pack-conversion-form";

type InventoryPackConversionModalProps = {
  /**
   * Empaque precargado; el usuario puede cambiarlo. Si el producto no es un
   * empaque con receta activa el campo queda vacío.
   */
  defaultPackProductId?: string;
  trigger?: ReactNode;
};

export function InventoryPackConversionModal({
  defaultPackProductId,
  trigger,
}: InventoryPackConversionModalProps = {}) {
  const [open, setOpen] = useState(false);
  const [packProductId, setPackProductId] = useState("");
  const [packQuantity, setPackQuantity] = useState("1");
  const [reason, setReason] = useState("");
  // Se activa al tocar la cantidad o al intentar enviar; al abrir no hay aviso.
  const [showQuantityError, setShowQuantityError] = useState(false);
  // Se activa al intentar enviar sin empaque elegido.
  const [showPackError, setShowPackError] = useState(false);
  const queryClient = useQueryClient();
  const packConversionsQuery = usePackConversions();
  const convert = useConvertPackToUnits();
  const requestAttempt = useRequestAttempt();
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
  // Sin `min`/`max` en el input no hay burbuja nativa: el motivo se dice aqui.
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
    setPackQuantity("1");
    setReason("");
    setShowQuantityError(false);
    setShowPackError(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setShowPackError(true);
      setShowQuantityError(true);
      return;
    }

    const input = {
      packProductId,
      packQuantity: quantityNumber,
      reason: reason.trim() || undefined,
    };
    // Clave de idempotencia del intento; null = ya hay un envio en vuelo (doble clic).
    const clientRequestId = requestAttempt.begin(input);

    if (!clientRequestId) {
      return;
    }

    try {
      const result = await convert.mutateAsync({ ...input, clientRequestId });
      requestAttempt.succeed();
      if (selected) {
        showToast(
          buildPackOpeningToast({
            packName: selected.packProduct.name,
            packQuantity: quantityNumber,
            recipe: selected,
            result,
          }),
        );
      }
      resetForm();
      setOpen(false);
    } catch (error) {
      requestAttempt.fail(error);
    }
  }

  return (
    <Modal
      contentClassName="sm:max-w-lg"
      description="Convierte empaques cerrados en unidades sueltas con movimiento de inventario emparejado."
      footer={({ close }) => (
        <FormActions
          isSubmitting={convert.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel="Convertir empaque"
          submittingLabel="Convirtiendo..."
        />
      )}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          convert.reset();
          setPackProductId(defaultPackProductId ?? "");
        } else {
          resetForm();
        }
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
      <form className="grid gap-4" id={formId} onSubmit={handleSubmit}>
        <EntityAutocomplete
          disabled={isLoadingDefaultPack}
          entity="product"
          error={showPackError && !selected ? "Selecciona un empaque." : undefined}
          fetcher={fetchPackOptions}
          helperText={
            isLoadingDefaultPack
              ? "Cargando empaque…"
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
          Preview: −{quantityNumber || 0} empaque(s) / +{unitPreview} unidad(es).
          {selected && isAssorted && unitPreview > 0
            ? ` Se abrirá en: ${describeRecipeOpening(selected, quantityNumber)}.`
            : null}
        </p>
        <Textarea
          label="Motivo"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Opcional"
          value={reason}
        />
        {convert.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {convert.error instanceof Error
              ? convert.error.message
              : "No se pudo convertir el empaque."}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
