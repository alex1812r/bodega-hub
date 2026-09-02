"use client";

import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";

import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { Textarea } from "@/shared/components/Textarea";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import { useConvertPackToUnits } from "@/modules/inventory/hooks/useInventory";

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
  const convert = useConvertPackToUnits();

  const isPack = packConversion?.role === "pack";
  const quantityNumber = Number(packQuantity);
  const unitPreview =
    isPack && quantityNumber > 0 && packConversion
      ? quantityNumber * packConversion.unitsPerPack
      : 0;
  const canSubmit =
    isPack && quantityNumber > 0 && quantityNumber <= productStock && Boolean(packConversion);

  const linkedHref = useMemo(
    () =>
      packConversion ? `/products/${packConversion.linkedProduct.id}` : undefined,
    [packConversion],
  );

  if (!packConversion) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !packConversion) {
      return;
    }

    try {
      await convert.mutateAsync({
        packProductId: productId,
        packQuantity: quantityNumber,
        reason: reason.trim() || undefined,
      });
      setOpen(false);
      setPackQuantity("1");
      setReason("");
      onConverted?.();
    } catch {
      return;
    }
  }

  return (
    <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-4">
      <h2 className="text-base font-semibold text-on-surface">Conversion empaque</h2>
      <p className="mt-1 text-sm text-on-surface-variant">
        {isPack
          ? `Este empaque se abre en ${packConversion.unitsPerPack} unidades.`
          : `Unidad suelta de un empaque (${packConversion.unitsPerPack} und/caja).`}
      </p>
      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-on-surface-variant">{isPack ? "Unidad" : "Empaque"}</dt>
          <dd className="text-right font-medium text-on-surface">
            {linkedHref ? (
              <Link className="underline-offset-2 hover:underline" href={linkedHref}>
                {packConversion.linkedProduct.name}
              </Link>
            ) : (
              packConversion.linkedProduct.name
            )}
          </dd>
        </div>
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

      {isPack ? (
        <Can permission="inventory.manage">
          <div className="mt-4">
            <Modal
              contentClassName="sm:max-w-md"
              description={`Abre cajas de ${productName} y suma unidades al producto suelto.`}
              footer={({ close }) => (
                <FormActions
                  isSubmitting={convert.isPending}
                  onCancel={close}
                  submitFormId="open-pack-form"
                  submitLabel="Abrir empaque"
                  submittingLabel="Convirtiendo..."
                />
              )}
              onOpenChange={setOpen}
              open={open}
              title="Abrir empaque"
              trigger={
                <Button size="sm" type="button" variant="outline">
                  Abrir empaque
                </Button>
              }
            >
              <form className="grid gap-4" id="open-pack-form" onSubmit={handleSubmit}>
                <Input
                  label="Cantidad de empaques"
                  max={productStock}
                  min={1}
                  onChange={(event) => setPackQuantity(event.target.value)}
                  required
                  type="number"
                  value={packQuantity}
                />
                <p className="text-sm text-on-surface-variant">
                  Salida: −{quantityNumber || 0} empaque(s). Entrada: +{unitPreview} unidad(es).
                  Stock actual empaque: {productStock}.
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
          </div>
        </Can>
      ) : null}
    </section>
  );
}
