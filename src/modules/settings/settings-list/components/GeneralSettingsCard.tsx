"use client";

import { getSettingsSavedMessage } from "@/lib/api/dataSourceUi";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { Input } from "@/shared/components/Input";
import { NumberInput } from "@/shared/components/NumberInput";
import { PAYMENT_METHODS, paymentMethodLabels } from "@/shared/payments/paymentMethods";

import type { GeneralSettingsForm, PendingSettingsSave } from "../useGeneralSettingsForm";
import { buildPaymentMethodEffects } from "../utils/paymentMethodsChange";

export const SETTINGS_FORM_ID = "settings-general-form";

type GeneralSettingsCardProps = {
  settings: GeneralSettingsForm;
};

function describeConsequences({ change, hasOtherChanges }: PendingSettingsSave) {
  return [
    change.disabled.length > 0
      ? "Los métodos que se deshabilitan dejan de ofrecerse al cobrar en el POS y al registrar pagos: cobros, abonos, pagos de compras y de nómina."
      : null,
    change.enabled.length > 0
      ? "Los métodos que se habilitan pasan a ofrecerse en el POS y al registrar pagos."
      : null,
    "Los pagos ya registrados no cambian.",
    hasOtherChanges ? "También se guardan los demás cambios del formulario." : null,
  ].filter((line): line is string => line !== null);
}

/**
 * «Datos generales» de Configuración. Se guarda con el botón de la cabecera
 * (`form={SETTINGS_FORM_ID}`); solo pide confirmación cuando cambian los métodos
 * de pago habilitados, mostrando cuáles (CNF-11).
 */
export function GeneralSettingsCard({ settings }: GeneralSettingsCardProps) {
  const { form, isLoading, loadError, pendingSave, saveError } = settings;
  const inlineSaveError = pendingSave ? null : saveError;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos generales</CardTitle>
        <CardDescription>Valores usados por facturacion, inventario y reportes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 md:grid-cols-2"
          id={SETTINGS_FORM_ID}
          onSubmit={settings.submit}
        >
          <Input
            disabled={isLoading}
            label="Nombre del negocio"
            onChange={(event) => settings.setField("businessName", event.target.value)}
            value={form.businessName}
          />
          <Input
            disabled={isLoading}
            label="Prefijo de factura"
            onChange={(event) => settings.setField("invoicePrefix", event.target.value)}
            value={form.invoicePrefix}
          />
          <NumberInput
            decimals={0}
            disabled={isLoading}
            label="Umbral bajo inventario"
            onChange={(event) => settings.setField("lowStockThreshold", event.target.value)}
            value={form.lowStockThreshold}
          />
          <NumberInput
            decimals={2}
            disabled={isLoading}
            helperText="0 = avisa ante cualquier faltante"
            label="Avisar al cerrar caja si el faltante supera (Bs)"
            min={0}
            onChange={(event) => settings.setField("cashCloseDiffAlertVes", event.target.value)}
            value={form.cashCloseDiffAlertVes}
          />

          <fieldset className="space-y-3 md:col-span-2">
            <legend className="text-sm font-medium text-foreground">
              Métodos de pago habilitados
            </legend>
            <p className="text-sm text-muted-foreground">
              Solo estos métodos estarán disponibles al vender y al registrar pagos. Debes dejar
              al menos uno activo. Al guardar se te pedirá confirmar lo que cambia.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PAYMENT_METHODS.map((method) => {
                const checked = form.enabledPaymentMethods.includes(method);
                const isLastEnabled = checked && form.enabledPaymentMethods.length === 1;

                return (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-container-lowest px-3 py-2 text-sm text-foreground dark:border-slate-700"
                    key={method}
                  >
                    <input
                      checked={checked}
                      className="size-4 accent-[var(--secondary)]"
                      disabled={isLoading || isLastEnabled}
                      onChange={() => settings.togglePaymentMethod(method)}
                      type="checkbox"
                    />
                    {paymentMethodLabels[method]}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {settings.isSaved || loadError || inlineSaveError ? (
            <div className="flex flex-wrap items-center gap-3 md:col-span-2">
              {settings.isSaved ? (
                <span className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
                  {getSettingsSavedMessage()}
                </span>
              ) : null}
              {loadError ? (
                <span className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]" role="alert">
                  {loadError.message}
                </span>
              ) : null}
              {inlineSaveError ? (
                <span className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]" role="alert">
                  {inlineSaveError.message}
                </span>
              ) : null}
            </div>
          ) : null}
        </form>
      </CardContent>

      {pendingSave ? (
        <ConfirmActionModal
          confirmLabel="Guardar cambios"
          description="Vas a cambiar los métodos de pago habilitados de la tienda."
          effects={buildPaymentMethodEffects(pendingSave.change)}
          error={saveError?.message}
          isPending={settings.isSaving}
          onConfirm={settings.confirmPendingSave}
          onOpenChange={(open) => {
            if (!open) {
              settings.cancelPendingSave();
            }
          }}
          open
          title="¿Guardar los métodos de pago?"
        >
          <ul className="list-disc space-y-1 pl-5">
            {describeConsequences(pendingSave).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </ConfirmActionModal>
      ) : null}
    </Card>
  );
}
