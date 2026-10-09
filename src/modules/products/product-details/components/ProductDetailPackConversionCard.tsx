"use client";

import Link from "next/link";
import { Fragment, type FormEvent, useMemo, useState } from "react";

import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { Textarea } from "@/shared/components/Textarea";
import { useToast } from "@/shared/components/Toast";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import { useConvertPackToUnits } from "@/modules/inventory/hooks/useInventory";
import { AssortedPackOpeningConfirm } from "@/modules/inventory/inventory-movements/components/AssortedPackOpeningConfirm";
import {
  AssortedPackOpeningActions,
  AssortedPackOpeningFields,
} from "@/modules/inventory/inventory-movements/components/AssortedPackOpeningFields";
import { buildPackOpeningToast } from "@/modules/inventory/inventory-movements/components/packOpeningText";
import { useAssortedPackOpening } from "@/modules/inventory/inventory-movements/hooks/useAssortedPackOpening";
import { useRequestAttempt } from "@/modules/inventory/utils/requestAttempt";
import { describeStockRequestError } from "@/modules/inventory/utils/stockRequestError";

type ProductDetailPackConversionCardProps = {
  packConversion?: ProductPackConversionSummary;
  productId: string;
  productName: string;
  productStock: number;
  onConverted?: () => void;
};

export function ProductDetailPackConversionCard({
  packConversion,
  productId,
  productName,
  productStock,
  onConverted,
}: ProductDetailPackConversionCardProps) {
  const [open, setOpen] = useState(false);
  const [packQuantity, setPackQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [quantityTouched, setQuantityTouched] = useState(false);
  const convert = useConvertPackToUnits();
  const requestAttempt = useRequestAttempt({ renewOnContentChange: true });
  const { showToast } = useToast();

  const isPack = packConversion?.role === "pack";
  const isAssorted = isPack && packConversion?.kind === "assorted";
  const components = packConversion?.components ?? [];
  // Empaques de los que sale el producto. Un vínculo sin `sources` (datos
  // anteriores al surtido) de rol unidad sale de su único empaque.
  const sources = useMemo(() => {
    if (!packConversion) {
      return [];
    }

    if (packConversion.sources?.length || packConversion.role === "pack") {
      return packConversion.sources ?? [];
    }

    return [
      {
        conversionId: packConversion.id,
        packName: packConversion.linkedProduct.name,
        packProductId: packConversion.linkedProduct.id,
        totalUnits: packConversion.totalUnits ?? packConversion.unitsPerPack,
        unitsPerPack: packConversion.unitsPerPack,
      },
    ];
  }, [packConversion]);
  const quantityNumber = Number(packQuantity);
  // Surtido: reparto editable y confirmación con su efecto. El 1 a 1 sigue por `handleSubmit`.
  const assorted = useAssortedPackOpening({
    onOpened: (result, effect) => {
      if (packConversion) {
        showToast(
          buildPackOpeningToast({
            packName: productName,
            packQuantity: effect.packQuantity,
            recipe: packConversion,
            result,
          }),
        );
      }
      closeAfterOpening();
    },
    packQuantity: quantityNumber,
    reason,
    target: isAssorted
      ? { components, pack: { currentStock: productStock, id: productId, name: productName } }
      : null,
  });
  const unitPreview =
    isPack && quantityNumber > 0 && packConversion
      ? quantityNumber * packConversion.unitsPerPack
      : 0;
  // Con decimales el propio campo avisa ("Debe ser un número entero."): aquí solo se bloquea el envío.
  const canSubmit =
    isPack &&
    quantityNumber > 0 &&
    Number.isInteger(quantityNumber) &&
    quantityNumber <= productStock &&
    Boolean(packConversion);
  // Aviso propio: con `max` en el input el navegador pinta su burbuja nativa.
  const stockError =
    productStock <= 0
      ? "No hay empaques en stock para abrir."
      : quantityNumber > productStock
        ? `Solo hay ${productStock} empaque(s) en stock.`
        : undefined;
  // Sin `min` en el input tampoco hay burbuja nativa para 0 o vacio: se avisa al tocar el campo.
  const quantityError =
    stockError ??
    (quantityTouched && !(quantityNumber > 0) ? "Indica una cantidad mayor a cero." : undefined);

  if (!packConversion) {
    return null;
  }

  const linkClassName = "font-medium text-on-surface underline-offset-2 hover:underline";
  const sourcesLine =
    sources.length > 0 ? (
      <p className="mt-1 text-sm text-on-surface-variant [overflow-wrap:anywhere]">
        Proviene de:{" "}
        {sources.map((source, index) => (
          <Fragment key={source.conversionId}>
            {index > 0 ? ", " : null}
            <Link className={linkClassName} href={`/products/${source.packProductId}`}>
              {source.packName}
            </Link>
          </Fragment>
        ))}
      </p>
    ) : null;
  const openLabel = isAssorted ? "Abrir según la receta" : "Abrir empaque";

  function closeAfterOpening() {
    setOpen(false);
    setPackQuantity("1");
    setReason("");
    setQuantityTouched(false);
    onConverted?.();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !packConversion) {
      return;
    }

    if (isAssorted) {
      assorted.openConfirm();
      return;
    }

    const input = {
      packProductId: productId,
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
      showToast(
        buildPackOpeningToast({
          packName: productName,
          packQuantity: quantityNumber,
          recipe: packConversion,
          result,
        }),
      );
      closeAfterOpening();
    } catch (error) {
      requestAttempt.fail(error);
    }
  }

  return (
    <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-4">
      <h2 className="text-base font-semibold text-on-surface">Conversión de empaque</h2>
      {isAssorted ? (
        <>
          <p className="mt-1 text-sm text-on-surface-variant [overflow-wrap:anywhere]">
            Se abre en:{" "}
            {components.map((component, index) => (
              <Fragment key={component.unitProductId}>
                {index > 0 ? " · " : null}
                {component.unitsPerPack}{" "}
                <Link className={linkClassName} href={`/products/${component.unitProductId}`}>
                  {component.name}
                </Link>
                {component.isActive ? null : " (inactivo)"}
              </Fragment>
            ))}
          </p>
          {sourcesLine}
          <dl className="mt-4 grid gap-2 text-sm">
            {packConversion.label ? (
              <div className="flex justify-between gap-3">
                <dt className="text-on-surface-variant">Surtido</dt>
                <dd className="text-right font-medium text-on-surface [overflow-wrap:anywhere]">
                  {packConversion.label}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Total por empaque</dt>
              <dd className="font-medium text-on-surface">
                {packConversion.totalUnits ?? packConversion.unitsPerPack} unidades
              </dd>
            </div>
          </dl>
        </>
      ) : isPack || sources.length <= 1 ? (
        <>
          {isPack ? (
            <p className="mt-1 text-sm text-on-surface-variant">
              Este empaque se abre en {packConversion.unitsPerPack} unidades.
            </p>
          ) : null}
          {sourcesLine}
          <dl className="mt-4 grid gap-2 text-sm">
            {isPack ? (
              <div className="flex justify-between gap-3">
                <dt className="text-on-surface-variant">Unidad</dt>
                <dd className="text-right font-medium text-on-surface">
                  <Link
                    className="underline-offset-2 hover:underline"
                    href={`/products/${packConversion.linkedProduct.id}`}
                  >
                    {packConversion.linkedProduct.name}
                  </Link>
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">
                Stock de {packConversion.linkedProduct.name}
              </dt>
              <dd className="font-medium text-on-surface">
                {packConversion.linkedProduct.currentStock}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Factor</dt>
              <dd className="font-medium text-on-surface">{packConversion.unitsPerPack}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          {sourcesLine}
          <dl className="mt-4 grid gap-2 text-sm">
            {sources.map((source) => (
              <div className="flex justify-between gap-3" key={source.conversionId}>
                <dt className="min-w-0 text-on-surface-variant [overflow-wrap:anywhere]">
                  {source.packName}
                </dt>
                <dd className="shrink-0 font-medium text-on-surface">
                  {source.unitsPerPack} und/caja
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {isPack ? (
        <Can permission="inventory.manage">
          <div className="mt-4">
            <Modal
              contentClassName="sm:max-w-md"
              description={
                isAssorted
                  ? `Abre cajas de ${productName} y suma a cada producto las unidades de su receta.`
                  : `Abre cajas de ${productName} y suma unidades al producto suelto.`
              }
              footer={({ close }) =>
                isAssorted ? (
                  <AssortedPackOpeningActions
                    formId="open-pack-form"
                    onCancel={close}
                    opening={assorted}
                  />
                ) : (
                  <FormActions
                    isSubmitting={convert.isPending}
                    onCancel={close}
                    submitFormId="open-pack-form"
                    submitLabel="Abrir empaque"
                    submittingLabel="Convirtiendo..."
                  />
                )
              }
              onOpenChange={(nextOpen) => {
                // Con una apertura en vuelo (1 a 1 o surtido) el modal no se cierra.
                if (!nextOpen && (convert.isPending || assorted.isPending)) {
                  return;
                }

                setOpen(nextOpen);
                if (!nextOpen) {
                  assorted.reset();
                  // Cerrar descarta el intento: al reabrir, clave nueva y sin el error anterior.
                  requestAttempt.discard();
                  convert.reset();
                }
              }}
              open={open}
              title="Abrir empaque"
              trigger={
                <Button size="sm" type="button" variant="outline">
                  {openLabel}
                </Button>
              }
            >
              <form className="grid gap-4" id="open-pack-form" onSubmit={handleSubmit}>
                <NumberInput
                  decimals={0}
                  disabled={convert.isPending}
                  error={quantityError}
                  label="Cantidad de empaques"
                  onChange={(event) => {
                    setPackQuantity(event.target.value);
                    setQuantityTouched(true);
                  }}
                  required
                  value={packQuantity}
                />
                <p className="text-sm text-on-surface-variant">
                  Salida: −{quantityNumber || 0} empaque(s). Entrada: +{unitPreview} unidad(es).
                  Stock actual empaque: {productStock}.
                </p>
                <AssortedPackOpeningFields opening={assorted} />
                <Textarea
                  disabled={convert.isPending}
                  label="Motivo"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Opcional"
                  value={reason}
                />
                {convert.error ? (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                    {describeStockRequestError(convert.error)}
                  </p>
                ) : null}
              </form>
              <AssortedPackOpeningConfirm opening={assorted} />
            </Modal>
          </div>
        </Can>
      ) : null}
    </section>
  );
}
